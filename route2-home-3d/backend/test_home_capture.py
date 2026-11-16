import copy
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from . import home_capture as api


class HomeCaptureTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.patches = [patch.object(api, "DATA", self.root / "homes"), patch.object(api, "ROOT", self.root), patch.dict("os.environ", {"ROUTE2_ENABLE_PIPELINE": "0"})]
        for p in self.patches:
            p.start()
        app = FastAPI()
        app.include_router(api.router)
        self.client = TestClient(app)

    def tearDown(self):
        for p in reversed(self.patches):
            p.stop()
        self.tmp.cleanup()

    def _capture(self):
        home_id = self.client.post('/api/route2/homes').json()['homeId']
        response = self.client.post(f'/api/route2/homes/{home_id}/capture', files={'file': ('room.mp4', b'fixture', 'video/mp4')})
        self.assertEqual(response.status_code, 202)
        return home_id, api.read(home_id)['jobId']

    def _write_model(self, scene):
        model = self.root / 'pipeline' / 'output' / scene / 'point_cloud' / 'iteration_30000' / 'point_cloud.ply'
        model.parent.mkdir(parents=True, exist_ok=True)
        model.write_bytes(b'ply\n' + b'0' * 1200)

    def _semantic_payload(self, home_id, captured_at, source='vision'):
        return {
            'schemaVersion': 1,
            'detector': {'provider': 'ultralytics-yolo-world', 'model': 'yolov8s-worldv2.pt', 'confidenceThreshold': 0.2},
            'localization': {'provider': 'colmap-track-anchor', 'coordinateFrame': 'colmap-arbitrary', 'metricScaleAvailable': False, 'minimumTrackPoints': 3},
            'observations': [],
            'snapshot': {
                'homeId': home_id,
                'version': 1,
                'capturedAt': captured_at,
                'scaleConfidence': 0.0,
                'rooms': [{'id': 'unknown-room', 'label': '待分区', 'kind': 'other'}],
                'objects': [{
                    'id': 'vision-bed-1',
                    'category': 'bed',
                    'label': 'bed',
                    'roomId': 'unknown-room',
                    'position': {'x': 0.1, 'y': -0.2, 'z': 1.3},
                    'confidence': 0.72,
                    'source': source,
                    'observedAt': 'runtime',
                    'evidence': {'imageIds': ['frame-0001.jpg'], 'annotationId': 'frame-0001:0'},
                    'localization': {'supportPointCount': 8, 'supportingCandidates': 1, 'coordinateFrame': 'colmap-arbitrary'},
                }],
                'relations': [],
                'routes': [],
            },
        }

    def test_capture_retained_waiting_and_isolated(self):
        a = self.client.post('/api/route2/homes').json()['homeId']
        b = self.client.post('/api/route2/homes').json()['homeId']
        result = self.client.post(f'/api/route2/homes/{a}/capture', files={'file': ('room.webm', b'video-fixture', 'video/webm')})
        self.assertEqual(result.status_code, 202)
        self.assertEqual(result.json()['status'], 'waiting_worker')
        self.assertNotIn('video', result.json())
        self.assertEqual(self.client.get(f'/api/route2/homes/{b}').json()['status'], 'empty')
        self.assertTrue((api.folder(a) / api.read(a)['video']).is_file())
        self.assertEqual(self.client.get(f'/api/route2/homes/{a}/model.ply').status_code, 409)
        self.assertEqual(self.client.post(f'/api/route2/homes/{a}/capture', files={'file': ('x.txt', b'x', 'text/plain')}).status_code, 415)
        old_job = result.json()['jobId']
        self.assertNotEqual(self.client.post(f'/api/route2/homes/{a}/retry').json()['jobId'], old_job)

    def test_worker_publishes_only_job_specific_model(self):
        home_id = self.client.post('/api/route2/homes').json()['homeId']
        self.client.post(f'/api/route2/homes/{home_id}/capture', files={'file': ('room.mp4', b'fixture', 'video/mp4')})
        scene = api.read(home_id)['jobId']
        commands = []
        def run(args, **kwargs):
            commands.append(args)
            if any('04_train' in str(arg) for arg in args):
                model = self.root / 'pipeline' / 'output' / scene / 'point_cloud' / 'iteration_30000' / 'point_cloud.ply'
                model.parent.mkdir(parents=True)
                model.write_bytes(b'ply\n' + b'0' * 1200)
            return type('Result', (), {'returncode': 0})()
        with patch.object(api.subprocess, 'run', side_effect=run):
            api.process(home_id)
        self.assertEqual(len(commands), 3)
        state = self.client.get(f'/api/route2/homes/{home_id}').json()
        self.assertEqual(state['status'], 'ready')
        self.assertTrue(state['modelReady'])
        self.assertFalse(state['semanticReady'])
        self.assertEqual(state['semanticStatus'], 'unavailable')
        self.assertIsNone(state['semanticUrl'])
        self.assertIn('未连接建模服务', state['semanticMessage'])
        self.assertEqual(self.client.get(f'/api/route2/homes/{home_id}/model.ply').status_code, 200)
        self.assertEqual(self.client.get(f'/api/route2/homes/{home_id}/semantic.json').status_code, 409)

    def test_failed_worker_keeps_video_and_restart_marks_interrupted(self):
        home_id = self.client.post('/api/route2/homes').json()['homeId']
        self.client.post(f'/api/route2/homes/{home_id}/capture', files={'file': ('room.mp4', b'fixture', 'video/mp4')})
        with patch.object(api.subprocess, 'run', side_effect=OSError()):
            api.process(home_id)
        self.assertEqual(api.read(home_id)['status'], 'failed')
        self.assertTrue((api.folder(home_id) / api.read(home_id)['video']).is_file())
        api.update(home_id, status='training')
        self.assertEqual(self.client.get(f'/api/route2/homes/{home_id}').json()['status'], 'failed')

    def test_semantic_capability_never_claims_non_windows_or_missing_gpu(self):
        with patch.dict('os.environ', {'ROUTE2_ENABLE_PIPELINE': '1'}), patch.object(api, '_on_windows', return_value=False):
            available, message = api.semantic_availability()
        self.assertFalse(available)
        self.assertIn('Windows', message)
        with patch.dict('os.environ', {'ROUTE2_ENABLE_PIPELINE': '1'}), patch.object(api, '_on_windows', return_value=True), patch.object(api, 'nvidia_command', return_value=None):
            available, message = api.semantic_availability()
        self.assertFalse(available)
        self.assertIn('NVIDIA', message)
        with patch.dict('os.environ', {'ROUTE2_ENABLE_PIPELINE': '1'}), patch.object(api, '_on_windows', return_value=True), patch.object(api, 'nvidia_command', return_value='nvidia-smi'), patch.object(api.subprocess, 'run', return_value=SimpleNamespace(returncode=0, stdout='GPU 0: fixture\n')):
            available, message = api.semantic_availability()
        self.assertTrue(available)
        self.assertIn('人工确认', message)

    def test_semantic_stage_publishes_only_matching_real_snapshot(self):
        home_id, scene = self._capture()
        accepted_at = api.read(home_id)['capturedAt']
        commands = []
        captured = {}

        def run(args, **kwargs):
            commands.append(args)
            target_scene = args[args.index('-Scene') + 1]
            if any('04_train' in str(arg) for arg in args):
                self._write_model(target_scene)
            if any('06_detect' in str(arg) for arg in args):
                captured['at'] = args[args.index('-CapturedAt') + 1]
                captured['home'] = args[args.index('-HomeId') + 1]
                output = self.root / 'pipeline' / 'data' / target_scene / 'semantic' / 'hometwin-semantic.json'
                output.parent.mkdir(parents=True)
                output.write_text(json.dumps(self._semantic_payload(home_id, captured['at'])), encoding='utf-8')
            return SimpleNamespace(returncode=0)

        with patch.object(api, 'semantic_availability', return_value=(True, '可尝试')), patch.object(api.subprocess, 'run', side_effect=run):
            api.process(home_id)
        self.assertEqual(len(commands), 4)
        self.assertEqual(captured['home'], home_id)
        self.assertRegex(captured['at'], r'^\d{4}-\d{2}-\d{2}T.*Z$')
        self.assertEqual(captured['at'], accepted_at)
        state = self.client.get(f'/api/route2/homes/{home_id}').json()
        self.assertEqual(state['capturedAt'], accepted_at)
        self.assertEqual(state['status'], 'ready')
        self.assertTrue(state['modelReady'])
        self.assertTrue(state['semanticReady'])
        self.assertEqual(state['semanticStatus'], 'ready')
        self.assertIn('/semantic.json', state['semanticUrl'])
        self.assertIn('1 个', state['semanticMessage'])
        self.assertEqual(self.client.get(f'/api/route2/homes/{home_id}/model.ply').status_code, 200)
        response = self.client.get(f'/api/route2/homes/{home_id}/semantic.json')
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload['snapshot']['homeId'], home_id)
        self.assertEqual(payload['snapshot']['capturedAt'], captured['at'])
        self.assertEqual(payload['snapshot']['objects'][0]['source'], 'vision')

    def test_semantic_failure_keeps_published_room_model(self):
        home_id, scene = self._capture()

        def run(args, **kwargs):
            if any('04_train' in str(arg) for arg in args):
                self._write_model(args[args.index('-Scene') + 1])
            if any('06_detect' in str(arg) for arg in args):
                return SimpleNamespace(returncode=1)
            return SimpleNamespace(returncode=0)

        with patch.object(api, 'semantic_availability', return_value=(True, '可尝试')), patch.object(api.subprocess, 'run', side_effect=run):
            api.process(home_id)
        state = self.client.get(f'/api/route2/homes/{home_id}').json()
        self.assertEqual(state['status'], 'ready')
        self.assertTrue(state['modelReady'])
        self.assertFalse(state['semanticReady'])
        self.assertEqual(state['semanticStatus'], 'failed')
        self.assertIsNone(state['semanticUrl'])
        self.assertIn('仍可查看', state['semanticMessage'])
        self.assertEqual(self.client.get(f'/api/route2/homes/{home_id}/model.ply').status_code, 200)
        self.assertEqual(self.client.get(f'/api/route2/homes/{home_id}/semantic.json').status_code, 409)

    def test_semantic_validation_rejects_demo_mismatch_and_guessed_coordinates(self):
        home_id = 'a' * 32
        captured_at = '2026-01-02T03:04:05Z'
        payload = self._semantic_payload(home_id, captured_at)
        self.assertEqual(api.validate_semantic(payload, home_id, captured_at), 1)
        for mutate in (
            lambda item: item['snapshot']['objects'][0].update(source='demo'),
            lambda item: item['snapshot'].update(homeId='b' * 32),
            lambda item: item['snapshot']['objects'][0]['position'].update(x=float('nan')),
            lambda item: item['snapshot']['objects'][0]['evidence'].update(imageIds=[]),
            lambda item: item['snapshot']['objects'][0]['localization'].update(coordinateFrame='metric'),
            lambda item: item['localization'].update(metricScaleAvailable=True),
            lambda item: item['snapshot'].update(relations=[
                {'subjectId': 'vision-bed-1', 'relation': 'connects', 'objectId': 'ghost', 'confidence': 0.9, 'source': 'inferred'}
            ]),
            lambda item: item['snapshot'].update(relations=[
                {'subjectId': 'vision-bed-1', 'relation': 'connects', 'objectId': 'vision-bed-1', 'confidence': 0.9, 'source': 'inferred'}
            ]),
            lambda item: item['snapshot'].update(routes=[{
                'id': 'r1', 'title': '床到卫生间', 'startObjectId': 'vision-bed-1', 'endObjectId': 'ghost',
                'objectIds': ['vision-bed-1'], 'hazardIds': [], 'confidence': 0.9, 'source': 'inferred'
            }]),
            lambda item: item['snapshot'].update(routes=[{
                'id': 'r1', 'title': '床到卫生间', 'startObjectId': 'vision-bed-1', 'endObjectId': 'vision-bed-1',
                'objectIds': ['vision-bed-1'], 'hazardIds': [], 'confidence': 0.9, 'source': 'demo'
            }]),
        ):
            invalid = copy.deepcopy(payload)
            mutate(invalid)
            with self.assertRaises(ValueError):
                api.validate_semantic(invalid, home_id, captured_at)

    def test_semantic_validation_accepts_consistent_relations_and_routes(self):
        home_id = 'a' * 32
        captured_at = '2026-01-02T03:04:05Z'
        payload = self._semantic_payload(home_id, captured_at)
        payload['snapshot']['rooms'].append({'id': 'bath', 'label': '卫生间', 'kind': 'bathroom'})
        payload['snapshot']['objects'].append({
            'id': 'vision-toilet-1',
            'category': 'toilet',
            'label': 'toilet',
            'roomId': 'bath',
            'position': {'x': 2.0, 'y': 0.0, 'z': -1.0},
            'confidence': 0.8,
            'source': 'vision',
            'observedAt': 'runtime',
            'evidence': {'imageIds': ['frame-0002.jpg'], 'annotationId': 'frame-0002:0'},
            'localization': {'supportPointCount': 6, 'supportingCandidates': 1, 'coordinateFrame': 'colmap-arbitrary'},
        })
        payload['snapshot']['relations'] = [
            {'subjectId': 'vision-bed-1', 'relation': 'connects', 'objectId': 'vision-toilet-1', 'confidence': 0.7, 'source': 'inferred'}
        ]
        payload['snapshot']['routes'] = [{
            'id': 'r1', 'title': '床到卫生间', 'startObjectId': 'vision-bed-1', 'endObjectId': 'vision-toilet-1',
            'objectIds': ['vision-bed-1', 'vision-toilet-1'], 'hazardIds': [], 'confidence': 0.7,
            'source': 'inferred', 'status': 'candidate'
        }]
        self.assertEqual(api.validate_semantic(payload, home_id, captured_at), 2)

    def test_capture_time_is_persisted_at_acceptance_and_reused_on_retry(self):
        home_id, _ = self._capture()
        accepted_at = api.read(home_id)['capturedAt']
        self.assertRegex(accepted_at, r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$')
        original = '2026-01-02T03:04:05Z'
        api.update(home_id, capturedAt=original)
        state = self.client.post(f'/api/route2/homes/{home_id}/retry').json()
        self.assertEqual(state['capturedAt'], original)
        self.assertEqual(api.read(home_id)['capturedAt'], original)

    def test_legacy_ready_state_without_model_flag_keeps_published_model(self):
        home_id, scene = self._capture()
        model = api.folder(home_id) / (scene + '.ply')
        model.write_bytes(b'ply\n' + b'0' * 1200)
        state = api.read(home_id)
        state.update(status='ready', model=model.name, modelUrl=f'/api/route2/homes/{home_id}/model.ply?v={scene}')
        state.pop('modelReady', None)
        api.write(api.folder(home_id), state)
        result = self.client.get(f'/api/route2/homes/{home_id}').json()
        self.assertTrue(result['modelReady'])
        self.assertIn('/model.ply', result['modelUrl'])
        self.assertEqual(result['semanticStatus'], 'unavailable')
        self.assertEqual(self.client.get(f'/api/route2/homes/{home_id}/model.ply').status_code, 200)

    def test_interrupted_semantic_stage_is_reported_without_hiding_model(self):
        home_id, scene = self._capture()
        model = api.folder(home_id) / (scene + '.ply')
        model.write_bytes(b'ply\n' + b'0' * 1200)
        api.update(home_id, status='ready', model=model.name, modelReady=True, semanticStatus='processing', semanticMessage='正在识别', semanticReady=False, semanticUrl=None)
        state = self.client.get(f'/api/route2/homes/{home_id}').json()
        self.assertEqual(state['status'], 'ready')
        self.assertTrue(state['modelReady'])
        self.assertFalse(state['semanticReady'])
        self.assertEqual(state['semanticStatus'], 'failed')
        self.assertIn('中断', state['semanticMessage'])
        self.assertIsNone(state['semanticUrl'])


if __name__ == '__main__':
    unittest.main()
