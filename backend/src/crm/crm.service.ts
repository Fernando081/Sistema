import { Injectable } from '@nestjs/common';
import { CrmOportunidadesService } from './crm-oportunidades.service';
import { CrmUnidadesService } from './crm-unidades.service';
import { CrmComercialService } from './crm-comercial.service';
import { CrmActividadService } from './crm-actividad.service';
@Injectable()
export class CrmService {
  constructor(
    private readonly oportunidades: CrmOportunidadesService,
    private readonly unidades: CrmUnidadesService,
    private readonly comercial: CrmComercialService,
    private readonly actividad: CrmActividadService,
  ) {}
  findAll(
    ...args: Parameters<CrmOportunidadesService['findAll']>
  ): ReturnType<CrmOportunidadesService['findAll']> {
    return this.oportunidades.findAll(...args);
  }
  findOne(
    ...args: Parameters<CrmOportunidadesService['findOne']>
  ): ReturnType<CrmOportunidadesService['findOne']> {
    return this.oportunidades.findOne(...args);
  }
  resumen(
    ...args: Parameters<CrmOportunidadesService['resumen']>
  ): ReturnType<CrmOportunidadesService['resumen']> {
    return this.oportunidades.resumen(...args);
  }
  busquedaGlobal(
    ...args: Parameters<CrmOportunidadesService['busquedaGlobal']>
  ): ReturnType<CrmOportunidadesService['busquedaGlobal']> {
    return this.oportunidades.busquedaGlobal(...args);
  }
  create(
    ...args: Parameters<CrmOportunidadesService['create']>
  ): ReturnType<CrmOportunidadesService['create']> {
    return this.oportunidades.create(...args);
  }
  update(
    ...args: Parameters<CrmOportunidadesService['update']>
  ): ReturnType<CrmOportunidadesService['update']> {
    return this.oportunidades.update(...args);
  }
  addSeguimiento(
    ...args: Parameters<CrmOportunidadesService['addSeguimiento']>
  ): ReturnType<CrmOportunidadesService['addSeguimiento']> {
    return this.oportunidades.addSeguimiento(...args);
  }
  getSeguimientos(
    ...args: Parameters<CrmOportunidadesService['getSeguimientos']>
  ): ReturnType<CrmOportunidadesService['getSeguimientos']> {
    return this.oportunidades.getSeguimientos(...args);
  }
  getVentasPerdidas(
    ...args: Parameters<CrmOportunidadesService['getVentasPerdidas']>
  ): ReturnType<CrmOportunidadesService['getVentasPerdidas']> {
    return this.oportunidades.getVentasPerdidas(...args);
  }
  registrarVentaPerdida(
    ...args: Parameters<CrmOportunidadesService['registrarVentaPerdida']>
  ): ReturnType<CrmOportunidadesService['registrarVentaPerdida']> {
    return this.oportunidades.registrarVentaPerdida(...args);
  }
  getUnidades(
    ...args: Parameters<CrmUnidadesService['getUnidades']>
  ): ReturnType<CrmUnidadesService['getUnidades']> {
    return this.unidades.getUnidades(...args);
  }
  getUnidadesCliente(
    ...args: Parameters<CrmUnidadesService['getUnidadesCliente']>
  ): ReturnType<CrmUnidadesService['getUnidadesCliente']> {
    return this.unidades.getUnidadesCliente(...args);
  }
  addUnidadCliente(
    ...args: Parameters<CrmUnidadesService['addUnidadCliente']>
  ): ReturnType<CrmUnidadesService['addUnidadCliente']> {
    return this.unidades.addUnidadCliente(...args);
  }
  addUnidad(
    ...args: Parameters<CrmUnidadesService['addUnidad']>
  ): ReturnType<CrmUnidadesService['addUnidad']> {
    return this.unidades.addUnidad(...args);
  }
  updateUnidad(
    ...args: Parameters<CrmUnidadesService['updateUnidad']>
  ): ReturnType<CrmUnidadesService['updateUnidad']> {
    return this.unidades.updateUnidad(...args);
  }
  deleteUnidad(
    ...args: Parameters<CrmUnidadesService['deleteUnidad']>
  ): ReturnType<CrmUnidadesService['deleteUnidad']> {
    return this.unidades.deleteUnidad(...args);
  }
  segmentos(
    ...args: Parameters<CrmComercialService['segmentos']>
  ): ReturnType<CrmComercialService['segmentos']> {
    return this.comercial.segmentos(...args);
  }
  createSegmento(
    ...args: Parameters<CrmComercialService['createSegmento']>
  ): ReturnType<CrmComercialService['createSegmento']> {
    return this.comercial.createSegmento(...args);
  }
  plantillas(
    ...args: Parameters<CrmComercialService['plantillas']>
  ): ReturnType<CrmComercialService['plantillas']> {
    return this.comercial.plantillas(...args);
  }
  createPlantilla(
    ...args: Parameters<CrmComercialService['createPlantilla']>
  ): ReturnType<CrmComercialService['createPlantilla']> {
    return this.comercial.createPlantilla(...args);
  }
  campanas(
    ...args: Parameters<CrmComercialService['campanas']>
  ): ReturnType<CrmComercialService['campanas']> {
    return this.comercial.campanas(...args);
  }
  createCampana(
    ...args: Parameters<CrmComercialService['createCampana']>
  ): ReturnType<CrmComercialService['createCampana']> {
    return this.comercial.createCampana(...args);
  }
  encuestas(
    ...args: Parameters<CrmComercialService['encuestas']>
  ): ReturnType<CrmComercialService['encuestas']> {
    return this.comercial.encuestas(...args);
  }
  createEncuesta(
    ...args: Parameters<CrmComercialService['createEncuesta']>
  ): ReturnType<CrmComercialService['createEncuesta']> {
    return this.comercial.createEncuesta(...args);
  }
  metas(
    ...args: Parameters<CrmComercialService['metas']>
  ): ReturnType<CrmComercialService['metas']> {
    return this.comercial.metas(...args);
  }
  createMeta(
    ...args: Parameters<CrmComercialService['createMeta']>
  ): ReturnType<CrmComercialService['createMeta']> {
    return this.comercial.createMeta(...args);
  }
  tareas(
    ...args: Parameters<CrmActividadService['tareas']>
  ): ReturnType<CrmActividadService['tareas']> {
    return this.actividad.tareas(...args);
  }
  createTarea(
    ...args: Parameters<CrmActividadService['createTarea']>
  ): ReturnType<CrmActividadService['createTarea']> {
    return this.actividad.createTarea(...args);
  }
  updateTarea(
    ...args: Parameters<CrmActividadService['updateTarea']>
  ): ReturnType<CrmActividadService['updateTarea']> {
    return this.actividad.updateTarea(...args);
  }
  comunicaciones(
    ...args: Parameters<CrmActividadService['comunicaciones']>
  ): ReturnType<CrmActividadService['comunicaciones']> {
    return this.actividad.comunicaciones(...args);
  }
  createComunicacion(
    ...args: Parameters<CrmActividadService['createComunicacion']>
  ): ReturnType<CrmActividadService['createComunicacion']> {
    return this.actividad.createComunicacion(...args);
  }
}
