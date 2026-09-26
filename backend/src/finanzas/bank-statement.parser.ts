import { BadRequestException } from '@nestjs/common';

export interface BankStatementRow {
  line: number;
  date: string;
  description: string;
  reference?: string;
  amount: number;
}

export interface BankStatementParseResult {
  rows: BankStatementRow[];
  errors: Array<{ line: number; message: string }>;
}

const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');

function parseCsv(text: string, delimiter: string) {
  const records: string[][] = [];
  let row: string[] = [], field = '', quoted = false;
  for (let i=0;i<text.length;i++) {
    const char=text[i];
    if (quoted) {
      if (char==='"' && text[i+1]==='"') { field+='"'; i++; }
      else if (char==='"') quoted=false;
      else field+=char;
    } else if (char==='"') quoted=true;
    else if (char===delimiter) { row.push(field); field=''; }
    else if (char==='\n') { row.push(field.replace(/\r$/,'')); records.push(row); row=[]; field=''; }
    else field+=char;
  }
  if (quoted) throw new BadRequestException('El CSV contiene una comilla sin cerrar');
  if (field.length || row.length) { row.push(field.replace(/\r$/,'')); records.push(row); }
  return records.filter(record=>record.some(value=>value.trim()));
}

function money(value: string) {
  let raw=value.trim().replace(/\s/g,'').replace(/[$€£]/g,'');
  const negative=raw.startsWith('(')&&raw.endsWith(')');
  raw=raw.replace(/[()]/g,'');
  const comma=raw.lastIndexOf(','),dot=raw.lastIndexOf('.');
  if (comma>=0&&dot>=0) raw=comma>dot?raw.replace(/\./g,'').replace(',','.'):raw.replace(/,/g,'');
  else if (comma>=0) raw=/,\d{1,2}$/.test(raw)?raw.replace(/\./g,'').replace(',','.'):raw.replace(/,/g,'');
  const parsed=Number(raw);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.round((negative?-parsed:parsed)*100)/100;
}

function date(value: string) {
  const raw=value.trim();
  let year:number,month:number,day:number;
  let match=raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (match) [,year,month,day]=match.map(Number);
  else {
    match=raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
    if (!match) return undefined;
    day=Number(match[1]);month=Number(match[2]);year=Number(match[3]);
  }
  const valueDate=new Date(Date.UTC(year,month-1,day));
  if (valueDate.getUTCFullYear()!==year||valueDate.getUTCMonth()!==month-1||valueDate.getUTCDate()!==day) return undefined;
  return `${year.toString().padStart(4,'0')}-${month.toString().padStart(2,'0')}-${day.toString().padStart(2,'0')}`;
}

const headerAliases = {
  date:['fecha','date','fecha operacion','fecha de operacion','fecha valor'],
  description:['descripcion','description','concepto','detalle','movimiento'],
  reference:['referencia','reference','folio','clave','rastreo'],
  amount:['monto','importe','amount'],
  debit:['cargo','cargos','retiro','retiros','debe'],
  credit:['abono','abonos','deposito','depositos','haber'],
};

export function parseBankStatementCsv(buffer: Buffer): BankStatementParseResult {
  if (!buffer.length) throw new BadRequestException('El archivo está vacío');
  const text=buffer.toString('utf8').replace(/^\uFEFF/,'');
  if (text.includes('\0')) throw new BadRequestException('El archivo contiene datos binarios');
  const first=text.split(/\r?\n/).find(line=>line.trim())||'';
  const delimiter=[',',';','\t'].map(value=>({value,count:first.split(value).length-1})).sort((a,b)=>b.count-a.count)[0];
  if (!delimiter.count) throw new BadRequestException('No se detectaron columnas CSV');
  const records=parseCsv(text,delimiter.value);
  if (records.length<2) throw new BadRequestException('El CSV no contiene movimientos');
  const headers=records[0].map(normalize);
  const index=(aliases:string[])=>headers.findIndex(header=>aliases.includes(header));
  const indexes={date:index(headerAliases.date),description:index(headerAliases.description),reference:index(headerAliases.reference),
    amount:index(headerAliases.amount),debit:index(headerAliases.debit),credit:index(headerAliases.credit)};
  if (indexes.date<0||indexes.description<0||(indexes.amount<0&&(indexes.debit<0||indexes.credit<0))) {
    throw new BadRequestException('Columnas requeridas: Fecha, Descripción y Monto; o Fecha, Descripción, Cargo y Abono');
  }
  const result:BankStatementParseResult={rows:[],errors:[]};
  records.slice(1).forEach((record,offset)=>{
    const line=offset+2,parsedDate=date(record[indexes.date]||''),description=(record[indexes.description]||'').trim();
    const parsedAmount=indexes.amount>=0?money(record[indexes.amount]||''):
      (()=>{const debit=money(record[indexes.debit]||'0'),credit=money(record[indexes.credit]||'0');return debit===undefined||credit===undefined?undefined:credit-debit})();
    if (!parsedDate) result.errors.push({line,message:'Fecha inválida'});
    else if (!description) result.errors.push({line,message:'Descripción vacía'});
    else if (parsedAmount===undefined||parsedAmount===0) result.errors.push({line,message:'Monto inválido o igual a cero'});
    else result.rows.push({line,date:parsedDate,description:description.slice(0,300),reference:indexes.reference>=0?(record[indexes.reference]||'').trim().slice(0,120)||undefined:undefined,amount:parsedAmount});
  });
  return result;
}
