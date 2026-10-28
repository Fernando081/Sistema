import { Injectable } from '@nestjs/common';
import { FiscalService } from '../fiscal/fiscal.service';

// Un solo generador de REP: el XML descargable es el mismo que se timbraría
// (emisor configurado, hora de Tampico, impuestos y UUID relacionados).
@Injectable()
export class RepXmlService {
  constructor(private readonly fiscalService: FiscalService) {}

  generarRepXml(idRep: number): Promise<string> {
    return this.fiscalService.previewXml('REP', idRep);
  }
}
