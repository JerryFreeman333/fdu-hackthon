import tempfile
import unittest
from pathlib import Path
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
        self.assertEqual(self.client.get(f'/api/route2/homes/{home_id}').json()['status'], 'ready')
        self.assertEqual(self.client.get(f'/api/route2/homes/{home_id}/model.ply').status_code, 200)

    def test_failed_worker_keeps_video_and_restart_marks_interrupted(self):
        home_id = self.client.post('/api/route2/homes').json()['homeId']
        self.client.post(f'/api/route2/homes/{home_id}/capture', files={'file': ('room.mp4', b'fixture', 'video/mp4')})
        with patch.object(api.subprocess, 'run', side_effect=OSError()):
            api.process(home_id)
        self.assertEqual(api.read(home_id)['status'], 'failed')
        self.assertTrue((api.folder(home_id) / api.read(home_id)['video']).is_file())
        api.update(home_id, status='training')
        self.assertEqual(self.client.get(f'/api/route2/homes/{home_id}').json()['status'], 'failed')


if __name__ == '__main__':
    unittest.main()
