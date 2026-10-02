# MQTT Messages: Media Orchestration & Manifest Pipeline

**Feature**: 004-media-orchestration-pipeline  
**Date**: 2026-04-05  
**MQTT Broker**: `mqtts://mqtt.openad.example.com:8883`

## Overview

This document defines the MQTT topics and message formats for real-time priority command delivery to tablets. MQTT is used for low-latency, push-based communication when immediate ad playback is required (e.g., emergency alerts, urgent promotions).

## Connection & Authentication

### Broker Configuration

- **Protocol**: MQTT over TLS (mqtts://)
- **Host**: `mqtt.openad.example.com`
- **Port**: `8883` (TLS) or `1883` (non-TLS, dev only)
- **QoS**: 1 (at least once delivery)
- **Clean Session**: `false` (persistent session for offline devices)

### Authentication

MQTT clients authenticate using JWT tokens:

```javascript
const client = mqtt.connect('mqtts://mqtt.openad.example.com:8883', {
  clientId: 'device-uuid',
  username: 'device-uuid',
  password: '<jwt_token>',
  clean: false,
  qos: 1,
  keepalive: 60,
  reconnectPeriod: 5000,
});
```

**JWT Token**:
- Same token used for REST API authentication
- Must have `role: device` claim
- Expires after 24 hours (client must refresh)

### Connection Lifecycle

1. **Connect**: Client connects with JWT credentials
2. **Subscribe**: Client subscribes to device-specific topic
3. **Receive**: Client receives priority commands
4. **Acknowledge**: Client sends ACK after processing command
5. **Disconnect**: Client disconnects gracefully (retains session)

## Topics

### 1. Priority Command Topic (Device-Specific)

**Topic Pattern**: `devices/{deviceId}/priority`

**Description**: Receives priority/emergency ad playback commands for a specific device.

**Subscription** (Client):
```javascript
client.subscribe('devices/device-uuid/priority', { qos: 1 }, (err) => {
  if (!err) {
    console.log('Subscribed to priority commands');
  }
});
```

**Publish** (Server):
```javascript
client.publish(
  'devices/device-uuid/priority',
  JSON.stringify(priorityCommand),
  { qos: 1, retain: false }
);
```

### 2. Priority Command Topic (Broadcast)

**Topic Pattern**: `devices/broadcast/priority`

**Description**: Receives priority commands intended for all devices (fleet-wide alerts).

**Subscription** (Client):
```javascript
client.subscribe('devices/broadcast/priority', { qos: 1 });
```

**Publish** (Server):
```javascript
client.publish(
  'devices/broadcast/priority',
  JSON.stringify(priorityCommand),
  { qos: 1, retain: false }
);
```

### 3. Command Acknowledgment Topic

**Topic Pattern**: `devices/{deviceId}/priority/ack`

**Description**: Client publishes acknowledgment after receiving and processing a priority command.

**Publish** (Client):
```javascript
client.publish(
  'devices/device-uuid/priority/ack',
  JSON.stringify(acknowledgment),
  { qos: 1, retain: false }
);
```

**Subscribe** (Server):
```javascript
client.subscribe('devices/+/priority/ack', { qos: 1 });
```

## Message Formats

### Priority Command Message

**Topic**: `devices/{deviceId}/priority` or `devices/broadcast/priority`  
**Direction**: Server → Client  
**QoS**: 1

**Payload**:
```json
{
  "commandId": "cmd-uuid",
  "deviceId": "device-uuid",
  "mediaId": "media-uuid",
  "priority": 5,
  "expiresAt": "2026-04-05T15:00:00Z",
  "createdAt": "2026-04-05T14:30:00Z",
  "metadata": {
    "campaignId": "campaign-uuid",
    "reason": "emergency-alert"
  }
}
```

**Fields**:
- `commandId` (required): Unique command identifier (UUID v4)
- `deviceId` (required): Target device UUID (or `"*"` for broadcast)
- `mediaId` (required): Media asset to play (must exist locally or be downloadable)
- `priority` (required): Priority level (1-5, where 5 = emergency)
  - `1`: Low priority (promotional)
  - `2`: Medium priority (time-sensitive offer)
  - `3`: High priority (important announcement)
  - `4`: Urgent (safety alert)
  - `5`: Emergency (critical alert)
- `expiresAt` (required): ISO 8601 timestamp when command expires
- `createdAt` (required): ISO 8601 timestamp when command was created
- `metadata` (optional): Additional context for logging/analytics

**Validation** (Client):
```typescript
import { PriorityCommandSchema } from '@openad/mqtt-contracts';

function handlePriorityCommand(message: string): void {
  try {
    const command = PriorityCommandSchema.parse(JSON.parse(message));
    
    // Check expiration
    if (new Date(command.expiresAt) < new Date()) {
      console.log('Command expired, ignoring');
      return;
    }
    
    // Check if media exists locally
    const mediaExists = await checkLocalMedia(command.mediaId);
    if (!mediaExists) {
      console.log('Media not available locally, downloading...');
      await downloadMedia(command.mediaId);
    }
    
    // Queue priority ad
    await queuePriorityAd(command);
    
    // Send acknowledgment
    sendAcknowledgment(command.commandId, 'queued');
    
  } catch (error) {
    console.error('Invalid priority command:', error);
    sendAcknowledgment(command.commandId, 'rejected', error.message);
  }
}
```

### Command Acknowledgment Message

**Topic**: `devices/{deviceId}/priority/ack`  
**Direction**: Client → Server  
**QoS**: 1

**Payload**:
```json
{
  "commandId": "cmd-uuid",
  "deviceId": "device-uuid",
  "status": "queued",
  "acknowledgedAt": "2026-04-05T14:30:05Z",
  "message": "Priority ad queued for playback"
}
```

**Fields**:
- `commandId` (required): Command ID being acknowledged
- `deviceId` (required): Device UUID
- `status` (required): Acknowledgment status
  - `queued`: Command received and ad queued for playback
  - `playing`: Ad is currently playing
  - `completed`: Ad playback completed
  - `rejected`: Command rejected (invalid, expired, or media unavailable)
  - `failed`: Playback failed (technical error)
- `acknowledgedAt` (required): ISO 8601 timestamp of acknowledgment
- `message` (optional): Human-readable status message
- `error` (optional): Error details if status is `rejected` or `failed`

**Example Acknowledgments**:

**Queued**:
```json
{
  "commandId": "cmd-uuid",
  "deviceId": "device-uuid",
  "status": "queued",
  "acknowledgedAt": "2026-04-05T14:30:05Z",
  "message": "Priority ad queued, will play after current ad"
}
```

**Playing**:
```json
{
  "commandId": "cmd-uuid",
  "deviceId": "device-uuid",
  "status": "playing",
  "acknowledgedAt": "2026-04-05T14:31:00Z",
  "message": "Priority ad now playing"
}
```

**Completed**:
```json
{
  "commandId": "cmd-uuid",
  "deviceId": "device-uuid",
  "status": "completed",
  "acknowledgedAt": "2026-04-05T14:32:00Z",
  "message": "Priority ad playback completed, resuming normal loop"
}
```

**Rejected** (Expired):
```json
{
  "commandId": "cmd-uuid",
  "deviceId": "device-uuid",
  "status": "rejected",
  "acknowledgedAt": "2026-04-05T15:05:00Z",
  "message": "Command expired",
  "error": "expiresAt timestamp is in the past"
}
```

**Rejected** (Media Not Available):
```json
{
  "commandId": "cmd-uuid",
  "deviceId": "device-uuid",
  "status": "rejected",
  "acknowledgedAt": "2026-04-05T14:30:05Z",
  "message": "Media not available",
  "error": "Media ID not found in local storage and download failed"
}
```

**Failed** (Playback Error):
```json
{
  "commandId": "cmd-uuid",
  "deviceId": "device-uuid",
  "status": "failed",
  "acknowledgedAt": "2026-04-05T14:31:30Z",
  "message": "Playback failed",
  "error": "Video codec not supported by device"
}
```

## Client Implementation (Tablet)

### Connection Setup

```typescript
import { MqttClient } from '@capgo/capacitor-mqtt';
import { PriorityCommandSchema } from '@openad/mqtt-contracts';

class MqttService {
  private client: MqttClient;
  private deviceId: string;
  
  async connect(deviceId: string, jwtToken: string): Promise<void> {
    this.deviceId = deviceId;
    
    this.client = await MqttClient.connect({
      serverURI: 'mqtts://mqtt.openad.example.com:8883',
      clientId: deviceId,
      username: deviceId,
      password: jwtToken,
      cleanSession: false,
      keepAlive: 60,
      qos: 1,
    });
    
    // Subscribe to device-specific topic
    await this.client.subscribe({
      topic: `devices/${deviceId}/priority`,
      qos: 1,
    });
    
    // Subscribe to broadcast topic
    await this.client.subscribe({
      topic: 'devices/broadcast/priority',
      qos: 1,
    });
    
    // Set up message handler
    this.client.on('message', (topic, message) => {
      this.handleMessage(topic, message);
    });
    
    console.log('MQTT connected and subscribed');
  }
  
  private async handleMessage(topic: string, message: string): Promise<void> {
    if (topic.endsWith('/priority')) {
      await this.handlePriorityCommand(message);
    }
  }
  
  private async handlePriorityCommand(message: string): Promise<void> {
    try {
      const command = PriorityCommandSchema.parse(JSON.parse(message));
      
      // Validate expiration
      if (new Date(command.expiresAt) < new Date()) {
        await this.sendAck(command.commandId, 'rejected', 'Command expired');
        return;
      }
      
      // Check if media is available locally
      const mediaAvailable = await this.checkMediaAvailable(command.mediaId);
      if (!mediaAvailable) {
        await this.sendAck(command.commandId, 'rejected', 'Media not available');
        return;
      }
      
      // Queue priority ad
      await this.queuePriorityAd(command);
      await this.sendAck(command.commandId, 'queued', 'Priority ad queued');
      
    } catch (error) {
      console.error('Failed to handle priority command:', error);
    }
  }
  
  async sendAck(
    commandId: string,
    status: string,
    message?: string,
    error?: string
  ): Promise<void> {
    const ack = {
      commandId,
      deviceId: this.deviceId,
      status,
      acknowledgedAt: new Date().toISOString(),
      message,
      error,
    };
    
    await this.client.publish({
      topic: `devices/${this.deviceId}/priority/ack`,
      message: JSON.stringify(ack),
      qos: 1,
      retain: false,
    });
  }
}
```

### Reconnection Logic

```typescript
class MqttService {
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  
  private async setupReconnection(): Promise<void> {
    this.client.on('disconnect', async () => {
      console.log('MQTT disconnected, attempting reconnection...');
      await this.reconnect();
    });
    
    this.client.on('error', async (error) => {
      console.error('MQTT error:', error);
      await this.reconnect();
    });
  }
  
  private async reconnect(): Promise<void> {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnection attempts reached');
      return;
    }
    
    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 60000);
    
    console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    await new Promise(resolve => setTimeout(resolve, delay));
    
    try {
      await this.connect(this.deviceId, await this.getJwtToken());
      this.reconnectAttempts = 0; // Reset on successful connection
      console.log('MQTT reconnected successfully');
    } catch (error) {
      console.error('Reconnection failed:', error);
      await this.reconnect();
    }
  }
}
```

## Server Implementation (NestJS Gateway)

### MQTT Gateway

```typescript
import { Injectable, OnModuleInit } from '@nestjs/common';
import { connect, MqttClient } from 'mqtt';
import { PriorityCommandSchema } from '@openad/mqtt-contracts';

@Injectable()
export class PriorityCommandsGateway implements OnModuleInit {
  private client: MqttClient;
  
  async onModuleInit(): Promise<void> {
    this.client = connect('mqtts://mqtt.openad.example.com:8883', {
      clientId: 'server-priority-gateway',
      username: process.env.MQTT_USERNAME,
      password: process.env.MQTT_PASSWORD,
      clean: false,
      qos: 1,
    });
    
    // Subscribe to acknowledgment topic
    this.client.subscribe('devices/+/priority/ack', { qos: 1 });
    
    this.client.on('message', (topic, message) => {
      this.handleAcknowledgment(topic, message.toString());
    });
  }
  
  async sendPriorityCommand(
    deviceId: string,
    mediaId: string,
    priority: number,
    expiresAt: Date
  ): Promise<void> {
    const command = {
      commandId: generateUuid(),
      deviceId,
      mediaId,
      priority,
      expiresAt: expiresAt.toISOString(),
      createdAt: new Date().toISOString(),
    };
    
    // Validate command
    PriorityCommandSchema.parse(command);
    
    // Publish to device-specific topic
    const topic = deviceId === '*' 
      ? 'devices/broadcast/priority' 
      : `devices/${deviceId}/priority`;
    
    this.client.publish(topic, JSON.stringify(command), { qos: 1 });
    
    console.log(`Priority command sent to ${deviceId}`);
  }
  
  private handleAcknowledgment(topic: string, message: string): void {
    try {
      const ack = JSON.parse(message);
      console.log(`Received ACK: ${ack.commandId} - ${ack.status}`);
      
      // Store acknowledgment in database for analytics
      // this.analyticsService.recordAcknowledgment(ack);
      
    } catch (error) {
      console.error('Failed to parse acknowledgment:', error);
    }
  }
}
```

## Message Flow Examples

### Example 1: Emergency Alert (Single Device)

**Server → Device**:
```json
Topic: devices/abc-123/priority
{
  "commandId": "cmd-001",
  "deviceId": "abc-123",
  "mediaId": "emergency-ad-001",
  "priority": 5,
  "expiresAt": "2026-04-05T15:00:00Z",
  "createdAt": "2026-04-05T14:30:00Z",
  "metadata": {
    "reason": "emergency-alert"
  }
}
```

**Device → Server** (Queued):
```json
Topic: devices/abc-123/priority/ack
{
  "commandId": "cmd-001",
  "deviceId": "abc-123",
  "status": "queued",
  "acknowledgedAt": "2026-04-05T14:30:02Z",
  "message": "Emergency ad queued"
}
```

**Device → Server** (Playing):
```json
Topic: devices/abc-123/priority/ack
{
  "commandId": "cmd-001",
  "deviceId": "abc-123",
  "status": "playing",
  "acknowledgedAt": "2026-04-05T14:30:30Z",
  "message": "Emergency ad now playing"
}
```

**Device → Server** (Completed):
```json
Topic: devices/abc-123/priority/ack
{
  "commandId": "cmd-001",
  "deviceId": "abc-123",
  "status": "completed",
  "acknowledgedAt": "2026-04-05T14:31:00Z",
  "message": "Emergency ad completed"
}
```

### Example 2: Fleet-Wide Broadcast

**Server → All Devices**:
```json
Topic: devices/broadcast/priority
{
  "commandId": "cmd-002",
  "deviceId": "*",
  "mediaId": "promo-ad-001",
  "priority": 2,
  "expiresAt": "2026-04-05T18:00:00Z",
  "createdAt": "2026-04-05T14:30:00Z",
  "metadata": {
    "campaignId": "spring-sale-2026",
    "reason": "promotional"
  }
}
```

**Device 1 → Server**:
```json
Topic: devices/abc-123/priority/ack
{
  "commandId": "cmd-002",
  "deviceId": "abc-123",
  "status": "queued",
  "acknowledgedAt": "2026-04-05T14:30:03Z"
}
```

**Device 2 → Server**:
```json
Topic: devices/def-456/priority/ack
{
  "commandId": "cmd-002",
  "deviceId": "def-456",
  "status": "queued",
  "acknowledgedAt": "2026-04-05T14:30:04Z"
}
```

## Best Practices

1. **QoS 1 (At Least Once)**: Ensures messages are delivered even if device is temporarily offline
2. **Persistent Sessions**: Use `cleanSession: false` to retain subscriptions across reconnections
3. **Exponential Backoff**: Implement reconnection logic with exponential backoff (max 60 seconds)
4. **Message Validation**: Always validate messages with Zod schemas before processing
5. **Expiration Checks**: Verify `expiresAt` timestamp before executing commands
6. **Acknowledgments**: Send ACK for every received command (success or failure)
7. **Error Handling**: Log all errors and send detailed error messages in ACKs
8. **Token Refresh**: Refresh JWT tokens before expiration (e.g., every 12 hours)
9. **Offline Buffering**: MQTT broker buffers messages for offline devices (up to 7 days)
10. **Monitoring**: Track ACK rates and latency for operational health

## Security Considerations

- **TLS Encryption**: Always use `mqtts://` (TLS) in production
- **JWT Authentication**: Validate JWT tokens on broker (use MQTT auth plugin)
- **Topic ACLs**: Restrict devices to subscribe only to their own topics
- **Message Signing**: Consider signing messages with HMAC for additional integrity
- **Rate Limiting**: Limit command frequency to prevent abuse (max 10/minute per device)

## Next Steps

- Implement MQTT gateway in NestJS
- Set up MQTT broker (Mosquitto or AWS IoT Core)
- Configure TLS certificates
- Implement client-side MQTT service in Angular/Capacitor
- Add monitoring and alerting for MQTT health
