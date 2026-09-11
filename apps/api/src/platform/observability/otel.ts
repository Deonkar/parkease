import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

const endpoint = process.env['OTEL_EXPORTER_OTLP_ENDPOINT'];

const sdkConfig: ConstructorParameters<typeof NodeSDK>[0] = {
  resource: new Resource({
    [ATTR_SERVICE_NAME]: process.env['OTEL_SERVICE_NAME'] ?? 'parkease-api',
    [ATTR_SERVICE_VERSION]: process.env['APP_VERSION'] ?? '0.0.0-dev',
  }),
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-http': {
        ignoreIncomingRequestHook: (req) => req.url?.startsWith('/api/v1/health') ?? false,
      },
      '@opentelemetry/instrumentation-fs': { enabled: false },
    }),
  ],
};

if (endpoint) {
  sdkConfig.traceExporter = new OTLPTraceExporter({ url: endpoint });
}

const sdk = new NodeSDK(sdkConfig);

sdk.start();

process.once('SIGTERM', () => {
  void sdk.shutdown().finally(() => process.exit(0));
});
