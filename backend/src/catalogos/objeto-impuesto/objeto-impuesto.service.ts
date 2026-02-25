// backend/src/catalogos/objeto-impuesto/objeto-impuesto.service.ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ObjetoImpuesto } from '../entities/objeto-impuesto.entity';

@Injectable()
export class ObjetoImpuestoService {
  constructor(
    @InjectRepository(ObjetoImpuesto) private repo: Repository<ObjetoImpuesto>,
  ) {}

  findAll() {
    return this.repo.find({ order: { clave: 'ASC' } });
  }
}
