import { Injectable,Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { queryRows } from '../common/database/typed-query';
import { runScheduledJob } from '../common/scheduled-job';
import { CampanaEjecucionService } from './campana-ejecucion.service';

/** O01.2c · Procesa cada minuto las simulaciones de campaña en curso (latido cada 9 min sin trabajo). */
@Injectable()
export class CampanaEjecucionEjecutor {
 private readonly logger=new Logger(CampanaEjecucionEjecutor.name);
 constructor(private readonly db:DataSource,private readonly service:CampanaEjecucionService){}

 @Cron('30 * * * * *')
 async programado(){
  try{
   const [r]=await queryRows<{latido:boolean}>(this.db,`SELECT coalesce((SELECT max(finished_at) FROM operational_job_run WHERE job_name='campaign_simulation' AND status='success')
     < clock_timestamp()-interval '9 minutes',true) AS latido`);
   if(!(await this.service.hayPendientes())&&!r?.latido)return 'idle';
   return await runScheduledJob(this.db,'campaign_simulation',async()=>{await this.service.procesar();},m=>this.logger.error(m));
  }catch{
   this.logger.error('Falló la simulación de campañas');
   return 'failed';
  }
 }
}
