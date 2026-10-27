import { Module } from '@nestjs/common';
import { PortalAdminController,PortalController } from './portal.controller';
import { PortalIdentityService } from './portal-identity.service';
import { PortalDocumentsService } from './portal-documents.service';
import { PortalPublicationsService } from './portal-publications.service';
import { PortalPublicationAdminController,PortalPublicationController } from './portal-publications.controller';
@Module({controllers:[PortalAdminController,PortalController,PortalPublicationAdminController,PortalPublicationController],providers:[PortalIdentityService,PortalDocumentsService,PortalPublicationsService]})
export class PortalModule {}
