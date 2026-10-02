import {
  tabletMqttReadRoutingKeyRegex,
  tabletMqttUsername,
  tabletMqttWriteRoutingKeyRegex,
} from './mqtt-topic-acl.util';

describe('mqtt-topic-acl.util', () => {
  const id = 'aaaaaaaa-bbbb-4ccc-dddd-aaaaaaaaaaaa';
  const other = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';

  it('tabletMqttUsername is stable and colon-free', () => {
    expect(tabletMqttUsername(id)).toBe(`openad-tablet-${id}`);
    expect(tabletMqttUsername(id)).not.toContain(':');
  });

  it('write regex allows own device routing keys only', () => {
    const re = new RegExp(tabletMqttWriteRoutingKeyRegex(id));
    expect(re.test(`openad.${id}.telemetry`)).toBe(true);
    expect(re.test(`openad.${id}.commands.ack`)).toBe(true);
    expect(re.test(`devices.${id}.heartbeat`)).toBe(true);
    expect(re.test(`devices.${id}.priority.ack`)).toBe(true);
    expect(re.test(`openad.${other}.telemetry`)).toBe(false);
    expect(re.test(`openad.${id}.schedule`)).toBe(false);
  });

  it('read regex allows own subscriptions and broadcast', () => {
    const re = new RegExp(tabletMqttReadRoutingKeyRegex(id));
    expect(re.test(`openad.${id}.schedule`)).toBe(true);
    expect(re.test(`openad.${id}.commands`)).toBe(true);
    expect(re.test(`devices.${id}.config`)).toBe(true);
    expect(re.test(`devices.${id}.priority`)).toBe(true);
    expect(re.test('openad.priority.broadcast')).toBe(true);
    expect(re.test(`openad.${other}.schedule`)).toBe(false);
    expect(re.test(`devices.${other}.config`)).toBe(false);
    expect(re.test(`openad.${id}.telemetry`)).toBe(false);
  });
});
