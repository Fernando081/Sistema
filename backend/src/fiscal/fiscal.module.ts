import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FiscalController } from './fiscal.controller';
import { loadFiscalSettings } from './fiscal.config';
import { FiscalService } from './fiscal.service';
import { FISCAL_PROVIDER } from './fiscal.types';
import { FiscalXmlBuilder } from './fiscal-xml.builder';
import { MockFiscalProvider } from './providers/mock-fiscal.provider';
import { SwFiscalProvider } from './providers/sw-fiscal.provider';

@Module({
  controllers: [FiscalController],
  providers: [
    FiscalService,
    FiscalXmlBuilder,
    {
      provide: FISCAL_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const settings = loadFiscalSettings(config);
        return settings.provider === 'sw' ? new SwFiscalProvider(settings) : new MockFiscalProvider();
      },
    },
  ],
  exports: [FiscalService],
})
export class FiscalModule {}
