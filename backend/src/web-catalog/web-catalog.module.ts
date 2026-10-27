import { Module } from '@nestjs/common';
import { WebCatalogService } from './web-catalog.service';
import { WebCatalogController } from './web-catalog.controller';
@Module({ controllers: [WebCatalogController], providers: [WebCatalogService] })
export class WebCatalogModule {}
