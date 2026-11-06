import * as grpc from '@grpc/grpc-js';
import { authorizeSend, HederaError } from './index.mjs';

// SDK 2.90.1 NodeChannel awaits initialization and waitForReady before dispatch.
// Its per-client factory supplies this channel; no global SDK channel cache is used.
export function guardedChannel(channel, config, rpc = grpc, allowedTargets) {
  const address = channel.address;
  const validateTarget = () => {
    if (!allowedTargets?.has(address) || channel.address !== address || `${channel.nodeIp}:${channel.nodePort}` !== address) throw new HederaError('TESTNET_ONLY');
  };
  let initializing;
  channel._initializeClient = async () => {
    validateTarget();
    if (channel._client) return;
    initializing ??= (async () => {
      const security = channel.nodePort === '50212'
        ? rpc.credentials.createSsl(Buffer.from(await channel._retrieveCertificate()))
        : rpc.credentials.createInsecure();
      validateTarget();
      const raw = new rpc.Client(address, security, {
        'grpc.ssl_target_name_override': '127.0.0.1', 'grpc.default_authority': '127.0.0.1',
        'grpc.http_connect_creds': '0', 'grpc.keepalive_time_ms': 100000,
        'grpc.keepalive_timeout_ms': 10000, 'grpc.keepalive_permit_without_calls': 1,
        'grpc.enable_retries': 0,
      });
      channel._client = new Proxy(raw, {get(target, name) {
        if (name === 'makeUnaryRequest') return (...args) => {
          try { authorizeSend(config); validateTarget(); } catch (error) { args.at(-1)(error); return; }
          return target.makeUnaryRequest(...args);
        };
        const value = Reflect.get(target, name);
        return typeof value === 'function' ? value.bind(target) : value;
      }});
    })();
    await initializing;
  };
  return channel;
}
