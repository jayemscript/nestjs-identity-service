//src/database/database.service.ts
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class DatabaseService {
  constructor(private readonly dataSource: DataSource) {}

  getDataSource(): DataSource {
    return this.dataSource;
  }
}
