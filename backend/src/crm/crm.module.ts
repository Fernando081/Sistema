import { CrmReportesController } from './crm-reportes.controller';
import { CrmReportesColaService } from './crm-reportes-cola.service';
import { CrmReportesService } from './crm-reportes.service';
import { CrmBandejaController } from './crm-bandeja.controller';
import { CrmBandejaService } from './crm-bandeja.service';
import { Module } from '@nestjs/common';
import { CrmController } from './crm.controller';
import { CrmService } from './crm.service';
import { CrmSolicitudesWebService } from './crm-solicitudes-web.service';
import { CrmSolicitudesWebController } from './crm-solicitudes-web.controller';
import { CrmSolicitudesWebMaintenance } from './crm-solicitudes-web-maintenance.service';
import { WebLeadBridgeController } from './web-lead-bridge.controller';
import { CrmWebMetricsService } from './crm-web-metrics.service';
import { CrmDocumentosService } from './crm-documentos.service';
import { CrmDocumentosController } from './crm-documentos.controller';

import { CrmOportunidadesService } from './crm-oportunidades.service';
import { CrmUnidadesService } from './crm-unidades.service';
import { CrmComercialService } from './crm-comercial.service';
import { CrmActividadService } from './crm-actividad.service';
import { UnidadExpedienteService } from './unidad-expediente.service';
import { UnidadExpedienteController } from './unidad-expediente.controller';
import { UnidadPiezasController } from './unidad-piezas.controller';
import { UnidadPiezasService } from './unidad-piezas.service';
import { CampanaConsentimientoService } from './campana-consentimiento.service';
import { CrmSecuenciasService } from './crm-secuencias.service';
import { CrmSecuenciasController } from './crm-secuencias.controller';
import { CrmSecuenciaReglasController } from './crm-secuencia-reglas.controller';
import { CrmSecuenciaReglasService } from './crm-secuencia-reglas.service';
import { CampanaEjecucionesController,CampanasLocalesController,ConsentimientoComercialController } from './campana-consentimiento.controller';
import { CampanaEjecucionService } from './campana-ejecucion.service';
import { CampanaEjecucionEjecutor } from './campana-ejecucion.ejecutor';

@Module({
  controllers: [CrmReportesController,CrmBandejaController,CrmSecuenciaReglasController,CrmSecuenciasController,CrmController, CrmSolicitudesWebController, WebLeadBridgeController, CrmDocumentosController,UnidadExpedienteController, UnidadPiezasController,CampanasLocalesController,CampanaEjecucionesController,ConsentimientoComercialController],
  providers: [
    CrmReportesService,
    CrmReportesColaService,
    CrmBandejaService,
    CrmService,
    CrmSolicitudesWebService,
    CrmSolicitudesWebMaintenance,
    CrmWebMetricsService,
    CrmDocumentosService,
    CrmOportunidadesService,
    CrmUnidadesService,
    CrmComercialService,
    CrmActividadService,
    UnidadExpedienteService,
    UnidadPiezasService,
    CampanaConsentimientoService,
    CampanaEjecucionService,
    CampanaEjecucionEjecutor,
    CrmSecuenciasService,
    CrmSecuenciaReglasService,
  ],
})
export class CrmModule {}
