import { generateAgentReply, parseElderInput } from '../src/engine/agent';
import { runDetection } from '../src/engine/detect';
import { extractBloodPressureValues, extractHealthValues } from '../src/engine/extract';
import { understandElderInput, acceptedSelfClaims } from '../src/engine/understanding';
import { measurementToEvent, observationToEvent, type HealthEvent } from '../src/pipeline/events';
import type { HealthMeasurement, Observation } from '../src/types';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const TODAY = '2026-09-10';

function bpValues(text: string): { systolic?: number; diastolic?: number } {
  return Object.fromEntries(extractBloodPressureValues(text).map((value) => [value.metric, value.value])) as {
    systolic?: number;
    diastolic?: number;
  };
}

function measurement(metric: HealthMeasurement['metric'], value: number, time = '12:00:00'): HealthMeasurement {
  return {
    id: `bp-${metric}-${value}-${time}`,
    timestamp: `${TODAY}T${time}`,
    metric,
    value,
    unit: 'mmHg',
    source: 'chat',
    confidence: 0.9,
    visibility: 'family_ok',
    metadata: { sourceText: `blood-pressure-${metric}-${value}-${time}`, extraction: 'rule', eventDate: TODAY },
  };
}

function observation(text: string, tags: Observation['tags']): Observation {
  return { id: `obs-${text}`, date: TODAY, source: 'chat', text, tags, visibility: 'family_ok' };
}

async function main() {
  const pairCases: Array<[string, number, number]> = [
    ['血压 150/90', 150, 90],
    ['血压150／90', 150, 90],
    ['血压150,90', 150, 90],
    ['血压150，90', 150, 90],
    ['血压150比90', 150, 90],
    ['血压150-90', 150, 90],
    ['高压150低压90', 150, 90],
    ['收缩压150舒张压90', 150, 90],
    ['低压90高压150', 150, 90],
    ['高压一百五，低压九十', 150, 90],
    ['血压一百五比九十', 150, 90],
    ['高压二百一十低压一百二十五', 210, 125],
  ];

  for (const [text, systolic, diastolic] of pairCases) {
    const values = bpValues(text);
    assert(values.systolic === systolic, `${text}: systolic extraction failed`);
    assert(values.diastolic === diastolic, `${text}: diastolic extraction failed`);
    assert(
      extractHealthValues(text).filter((value) => value.unit === 'mmHg').length === 2,
      `${text}: two BP values required`,
    );
    assert(parseElderInput(text).tags.includes('bpHigh'), `${text}: chat parser must see the same BP fact`);
  }

  for (const [text, systolic, diastolic] of [
    ['我血压150', 150, undefined],
    ['高压150', 150, undefined],
    ['我刚量出来高压210', 210, undefined],
  ] as const) {
    const values = bpValues(text);
    assert(values.systolic === systolic, `${text}: single-value systolic extraction failed`);
    assert(values.diastolic === diastolic, `${text}: partial reading must not invent diastolic`);
    assert(
      extractHealthValues(text).some((value) => value.metric === 'systolic'),
      `${text}: value must not be dropped`,
    );
    assert(parseElderInput(text).tags.includes('bpHigh'), `${text}: partial BP must reach chat safety layer`);
  }

  const structured = understandElderInput('高压210低压125', TODAY);
  const accepted = acceptedSelfClaims(structured);
  assert(accepted.length === 1, 'dangerous BP statement must become an accepted self claim');
  assert(accepted[0].hasHealthValue === true, 'dangerous BP statement must carry structured health value');
  assert(accepted[0].tags.includes('bpHigh'), 'dangerous BP claim must retain BP intent');

  const commaStructured = understandElderInput('血压150,90', TODAY);
  const commaClaim = acceptedSelfClaims(commaStructured)[0];
  assert(commaClaim?.hasHealthValue === true, 'comma-separated BP must survive structured clause splitting');
  const commaClaimValues = extractHealthValues(commaClaim?.text ?? '');
  assert(
    commaClaimValues.some((value) => value.metric === 'systolic' && value.value === 150),
    'comma BP systolic must survive',
  );
  assert(
    commaClaimValues.some((value) => value.metric === 'diastolic' && value.value === 90),
    'comma BP diastolic must survive',
  );

  const labeledCommaStructured = understandElderInput('高压150,低压90', TODAY);
  const labeledClaim = acceptedSelfClaims(labeledCommaStructured)[0];
  assert(labeledClaim?.hasHealthValue === true, 'labeled comma BP must remain one health claim');
  assert(
    extractHealthValues(labeledClaim?.text ?? '').filter((value) => value.unit === 'mmHg').length === 2,
    'labeled comma BP must keep both values',
  );

  const unrelatedCommaStructured = understandElderInput('我今天头晕，也想告诉你血压150,90', TODAY);
  const unrelatedClaims = acceptedSelfClaims(unrelatedCommaStructured);
  assert(
    unrelatedClaims.some((claim) => claim.tags.includes('dizziness')),
    'ordinary comma symptom clause must remain parseable',
  );
  assert(
    unrelatedClaims.some((claim) => claim.hasHealthValue),
    'ordinary comma must not swallow a later BP fact',
  );

  const events: HealthEvent[] = [
    measurementToEvent(measurement('systolic', 210)),
    measurementToEvent(measurement('diastolic', 125)),
  ];
  const findings = runDetection(events, TODAY);
  const safety = findings.find((finding) => finding.ruleId === 'safety.blood_pressure.severe_reading');
  assert(safety, '210/125 must enter the safety rule');
  assert(safety.severity === 'alert', '210/125 without red-flag symptoms should be alert');
  assert(safety.familyEligible === true, 'objective severe BP should remain family eligible');

  const repeatMeasurementEvents: HealthEvent[] = [
    measurementToEvent(measurement('systolic', 210, '09:00:00')),
    measurementToEvent(measurement('diastolic', 125, '09:00:00')),
    measurementToEvent(measurement('systolic', 170, '09:10:00')),
    measurementToEvent(measurement('diastolic', 90, '09:10:00')),
  ];
  const repeatFindings = runDetection(repeatMeasurementEvents, TODAY);
  const repeatSafety = repeatFindings.find((finding) => finding.ruleId === 'safety.blood_pressure.severe_reading');
  assert(repeatSafety, 'a dangerous earlier BP reading must not disappear after a normal recheck');
  assert(
    repeatSafety.evidence.some((item) => item.includes('210')),
    'safety evidence must retain the earlier dangerous reading',
  );

  const dangerousWithSymptom = runDetection(
    [...events, observationToEvent(observation('我高压210，而且现在喘得厉害', ['dyspnea']))],
    TODAY,
  );
  const urgent = dangerousWithSymptom.find((finding) => finding.ruleId === 'safety.blood_pressure.severe_reading');
  assert(urgent?.severity === 'urgent', 'severe BP plus dyspnea must upgrade to urgent');

  const partialReply = await generateAgentReply('我刚量出来高压210', ['bpHigh'], [], false);
  assert(partialReply.includes('210'), 'chat response must preserve partial BP number');
  assert(partialReply.includes('复测'), 'dangerous partial BP must receive recheck guidance');

  const normalPairReply = await generateAgentReply('血压150比90', ['bpHigh'], [], false);
  assert(normalPairReply.includes('150/90'), 'chat response must normalize spoken pair to a complete reading');

  const shouldNotCrash = await generateAgentReply('高压一百五低压九十', ['bpHigh'], [], false);
  assert(shouldNotCrash.length > 0, 'oral Chinese BP forms must produce a response');

  console.log(
    'PASS: adversarial blood pressure extraction, semantic routing, detection, repeat readings, clause splitting, and chat safety',
  );
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
