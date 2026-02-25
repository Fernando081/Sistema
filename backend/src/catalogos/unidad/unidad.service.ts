// backend/src/catalogos/unidad/unidad.service.ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Unidad } from '../entities/unidad.entity';

@Injectable()
export class UnidadService {
  constructor(@InjectRepository(Unidad) private repo: Repository<Unidad>) {}

  findAll() {
    return this.repo.find({ order: { descripcion: 'ASC' } });
  }
}
