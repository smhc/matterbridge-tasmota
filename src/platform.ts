import mqtt, { Client } from 'mqtt';
import {
  BooleanState,
  ClusterId,
  DeviceTypes,
  Endpoint,
  FanControl,
  FanControlCluster,
  PlatformConfig,
  bridgedNode,
} from 'matterbridge';

import { Matterbridge, MatterbridgeDevice, MatterbridgeDynamicPlatform } from 'matterbridge';
import { AnsiLogger, db, hk, or } from 'matterbridge/logger';

const brokerUrl = 'mqtt://192.168.1.118';
const catFlapStatusTopic = 'catflap/lockstatus';
const workshopStatusTopic = 'tele/tasmota_CFDC7C/LWT';
const fanStatusTopic = 'stat/tasmota_B7C8F7/STATUS11';
const garageDoorStatusTopic = 'esp/garage/door';

const fanCmdTopic = 'cmnd/tasmota_B7C8F7/';

export class TasmotaBridgeDynamicPlatform extends MatterbridgeDynamicPlatform {
  workshopContact: MatterbridgeDevice | undefined;
  catdoorContact: MatterbridgeDevice | undefined;
  client: mqtt.MqttClient | undefined;
  fan: MatterbridgeDevice | undefined;

  constructor(matterbridge: Matterbridge, log: AnsiLogger, config: PlatformConfig) {
    super(matterbridge, log, config);
    this.log.info('Initializing platform:', this.config.name);
  }

  override async onStart(reason?: string) {
    this.log.info('onStart called with reason:', reason ?? 'none');

    // // Create a contact device
    this.workshopContact = new MatterbridgeDevice(DeviceTypes.CONTACT_SENSOR);
    this.workshopContact.log.logName = 'workshopContact';
    this.workshopContact.createDefaultIdentifyClusterServer();
    this.workshopContact.createDefaultGroupsClusterServer();
    this.workshopContact.createDefaultScenesClusterServer();
    this.workshopContact.createDefaultBridgedDeviceBasicInformationClusterServer('workshopContact', '0x123151164', 0xfff1, 'smhc', 'Tasmota matter bridge contact');
    this.workshopContact.createDefaultOnOffClusterServer();
    await this.registerDevice(this.workshopContact);

    // // Create a contact device
    this.catdoorContact = new MatterbridgeDevice(DeviceTypes.CONTACT_SENSOR);
    this.catdoorContact.log.logName = 'catdoorContact';
    this.catdoorContact.createDefaultIdentifyClusterServer();
    this.catdoorContact.createDefaultGroupsClusterServer();
    this.catdoorContact.createDefaultScenesClusterServer();
    this.catdoorContact.createDefaultBridgedDeviceBasicInformationClusterServer('catdoorContact', '0x123151165', 0xfff1, 'smhc', 'Tasmota matter bridge contact');
    this.catdoorContact.createDefaultOnOffClusterServer();
    await this.registerDevice(this.catdoorContact);

    // // Create a fan device
    this.fan = new MatterbridgeDevice([DeviceTypes.FAN, bridgedNode], undefined, this.config.debug as boolean);
    this.fan.log.logName = 'Fan';
    this.fan.createDefaultBridgedDeviceBasicInformationClusterServer('Fan', 'serial_980545631229', 0xfff1, 'smhc', 'Matterbridge Fan', 2, '2.1.1');
    this.fan.addDeviceTypeWithClusterServer([DeviceTypes.FAN], []);
    await this.registerDevice(this.fan);
    this.fanMatterSubscribe(this.fan);
  }

  private catFlapMqttStatusMessage(message: Buffer) {
    let onoffStatus = this.catdoorContact?.getClusterServerById(BooleanState.Cluster.id)?.getStateValueAttribute();
    this.log.info(`Mqtt message received: ${message.toString()}`);
    if (message.toString().startsWith('locked')) {
      onoffStatus = true;
    }
    this.catdoorContact?.getClusterServerById(BooleanState.Cluster.id)?.setStateValueAttribute(onoffStatus);
    this.catdoorContact?.getClusterServerById(BooleanState.Cluster.id)?.triggerStateChangeEvent({ stateValue: onoffStatus });
  }

  private workshopMqttStatusMessage(message: Buffer) {

  }

  private fanMqttStatusMessage(message: Buffer) {
    let json = JSON.parse(message.toString());
    this.fan?.log.info(`Mqtt message received: ${message.toString()}`);
    let fanspeed = json.StatusSTS?.FanSpeed;
    // this.fan?.getDefaultFanControlClusterServer()?.setSpeedCurrentAttribute(fanspeed);
    this.fan?.getClusterServerById(FanControlCluster.id)?.setSpeedCurrentAttribute(fanspeed);
    this.fan?.getClusterServerById(FanControlCluster.id)?.triggerStateChangeEvent({ stateValue: fanspeed });
  }

  override async onConfigure() {
    this.log.info('onConfigure called');
    let onoff = false;

    this.workshopContact?.getClusterServerById(BooleanState.Cluster.id)?.setStateValueAttribute(onoff);
    this.workshopContact?.getClusterServerById(BooleanState.Cluster.id)?.triggerStateChangeEvent({ stateValue: onoff });
    this.log.info(`Set workshopContact to ${onoff}`);

    this.catdoorContact?.getClusterServerById(BooleanState.Cluster.id)?.setStateValueAttribute(onoff);
    this.catdoorContact?.getClusterServerById(BooleanState.Cluster.id)?.triggerStateChangeEvent({ stateValue: onoff });
    this.log.info(`Set catdoorContact to ${onoff}`);

    // Connect to the MQTT broker
    this.client = mqtt.connect(brokerUrl);

    if (this.client === undefined || this.client === null) {
      this.log.error('Mqtt connect failed');
      return;
    }

    // Handle connection events
    this.client.on('connect', () => {
      this.log.info(`Connected to MQTT broker at ${brokerUrl}`);

      if (this.client === undefined || this.client === null) {
        this.log.error('Mqtt no client connection');
        return;
      }

      // Subscribe to cat door topic
      this.client.subscribe(catFlapStatusTopic, (err: Error | null) => {
        if (err) {
          this.log.error(`Failed to subscribe to ${catFlapStatusTopic}:`, err);
        } else {
          this.log.info(`Subscribed to ${catFlapStatusTopic}`);
        }
      });
      // Subscribe to workshop topic
      this.client.subscribe(workshopStatusTopic, (err: Error | null) => {
        if (err) {
          this.log.error(`Failed to subscribe to ${workshopStatusTopic}:`, err);
        } else {
          this.log.info(`Subscribed to ${workshopStatusTopic}`);
        }
      });
      // Subscribe to fan topic
      this.client.subscribe(fanStatusTopic, (err: Error | null) => {
        if (err) {
          this.log.error(`Failed to subscribe to ${fanStatusTopic}:`, err);
        } else {
          this.log.info(`Subscribed to ${fanStatusTopic}`);
        }
      });

      // Handle incoming messages
      this.client.on('message', (topic: string, message: Buffer) => {
        switch(topic) {
          case catFlapStatusTopic:
            this.catFlapMqttStatusMessage(message);
            break;
          case workshopStatusTopic:
            this.workshopMqttStatusMessage(message);
            break;
          case fanStatusTopic:
            this.fanMqttStatusMessage(message);
            break;
        }
      });

      // Handle errors
      this.client.on('error', (err: Error) => {
        this.log.error('Mqtt error:', err);
      });

      // Handle disconnection
      this.client.on('close', () => {
        this.log.info('Disconnected from mqtt broker');
      });
    });
  }

  override async onShutdown(reason?: string) {
    this.log.info('onShutdown called with reason:', reason ?? 'none');
    if (this.config.unregisterOnShutdown === true) await this.unregisterAllDevices();
  }

  private fanMatterSubscribe(fan: MatterbridgeDevice) {
    const fanCluster = fan.getClusterServer(FanControlCluster.with(FanControl.Feature.MultiSpeed));
    const bridge = this;

    function fanSpeedChange(speed: number) {
      if (fanCluster) {
        fanCluster.setSpeedCurrentAttribute(speed);
        bridge.client?.publish(fanCmdTopic + 'FanSpeed', speed.toString());
      }
    }

    function fanPercentChange(perc: number) {
      if (fanCluster) {
        fanCluster.setPercentCurrentAttribute(perc);
        let fanSpeed = 0;
        if (perc >= 66) {
          fanSpeed = 3;
        } else if (perc >= 33) {
          fanSpeed = 2;
        } else if (perc > 0) {
          fanSpeed = 1;
        }
        bridge.client?.publish(fanCmdTopic + 'FanSpeed', fanSpeed.toString());
      }
    }

    if (fanCluster) {
      const fanModeLookup = ['Off', 'Low', 'Medium', 'High', 'On', 'Auto', 'Smart'];
      subscribeAttribute(
        FanControlCluster.id,
        'fanMode',
        (newValue: FanControl.FanMode, oldValue: FanControl.FanMode) => {
          fan?.log.info(`Fan mode changed from ${fanModeLookup[oldValue]} to ${fanModeLookup[newValue]}`);
          if (newValue === FanControl.FanMode.Off) {
            fanPercentChange(0);
          } else if (newValue === FanControl.FanMode.Low) {
            fanPercentChange(33);
          } else if (newValue === FanControl.FanMode.Medium) {
            fanPercentChange(66);
          } else if (newValue === FanControl.FanMode.High) {
            fanPercentChange(100);
          } else if (newValue === FanControl.FanMode.On) {
            fanPercentChange(100);
          } else if (newValue === FanControl.FanMode.Auto) {
            fanPercentChange(50);
          }
        },
        fan.log,
        fan,
      );
      subscribeAttribute(
        FanControlCluster.id,
        'percentSetting',
        (newValue: number | null, oldValue: number | null) => {
          fan?.log.info(`Percent setting changed from ${oldValue} to ${newValue}`);
          if (newValue) fanPercentChange(newValue);
        },
        fan.log,
        fan,
      );
      subscribeAttribute(
        FanControlCluster.id,
        'speedSetting',
        (newValue: number | null, oldValue: number | null) => {
          fan?.log.info(`Speed setting changed from ${oldValue} to ${newValue}`);
          if (newValue) fanSpeedChange(newValue);
        },
        fan.log,
        fan,
      );
    }
  }
}


// eslint-disable-next-line @typescript-eslint/no-explicit-any
function subscribeAttribute(clusterId: ClusterId, attribute: string, listener: (newValue: any, oldValue: any) => void, log?: AnsiLogger, endpoint?: Endpoint): boolean {
  // if (!endpoint) endpoint = this as Endpoint;
  if (!endpoint) return false;

  const clusterServer = endpoint.getClusterServerById(clusterId);
  if (!clusterServer) {
    log?.error(`subscribeAttribute error: Cluster ${clusterId} not found on endpoint ${endpoint.name}:${endpoint.number}`);
    return false;
  }
  const capitalizedAttributeName = attribute.charAt(0).toUpperCase() + attribute.slice(1);
  if (!clusterServer.isAttributeSupportedByName(attribute) && !clusterServer.isAttributeSupportedByName(capitalizedAttributeName)) {
    if (log) log.error(`subscribeAttribute error: Attribute ${attribute} not found on Cluster ${clusterServer.name} on endpoint ${endpoint.name}:${endpoint.number}`);
    return false;
  }
  // Find the subscribe method
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!(clusterServer as any)[`subscribe${capitalizedAttributeName}Attribute`]) {
    log?.error(
      `subscribeAttribute error: subscribe${capitalizedAttributeName}Attribute not found on Cluster ${clusterServer.name} on endpoint ${endpoint.name}:${endpoint.number}`,
    );
    return false;
  }
  // Subscribe to the attribute
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-empty-object-type
  const subscribe = (clusterServer as any)[`subscribe${capitalizedAttributeName}Attribute`] as (listener: (newValue: any, oldValue: any) => void) => {};
  subscribe(listener);
  log?.info(`${db}Subscribe endpoint ${or}${endpoint.name}:${endpoint.number}${db} attribute ${hk}${clusterServer.name}.${capitalizedAttributeName}${db}`);
  return true;
}