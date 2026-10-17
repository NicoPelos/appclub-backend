import { formatISO } from 'date-fns';
import { appendToSheet, updateSheetRow } from '../../../services/googleSheetsService.js';

export const buildSocioSheetRow = (socio) => {
  const formatDate = (value) => {
    if (!value) return '';
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? '' : formatISO(date, { representation: 'date' });
  };

  return [
    socio.socioNumber || '',
    socio.sexo || '',
    socio.apellido || '',
    socio.nombre || '',
    socio.dni || '',
    formatDate(socio.fechaNacimiento),
    socio.direccionActual || '',
    socio.domicilioCompleto || '',
    socio.calle || '',
    socio.altura || '',
    socio.ciudad || '',
    socio.nacionalidad || '',
    formatDate(socio.fechaDeAsociado),
    socio.estado || '',
    socio.condicionObs || '',
    socio.correoElectronico || '',
    socio.telefono || '',
    socio.telefonoEmergencia || '',
    socio.observaciones || '',
  ];
};

const normalizeHeader = (text) => {
  const normalized = text?.toString().trim().toLowerCase() || '';
  return normalized
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const headerMap = {
  'socio n': 'socioNumber',
  'socio nro': 'socioNumber',
  'nro socio': 'socioNumber',
  'socio number': 'socioNumber',
  'sexo': 'sexo',
  'apellido': 'apellido',
  'nombre': 'nombre',
  'dni': 'dni',
  'fecha nacimiento': 'fechaNacimiento',
  'fecha de nacimiento': 'fechaNacimiento',
  'direccion actual': 'direccionActual',
  'domicilio completo': 'domicilioCompleto',
  'calle': 'calle',
  'altura': 'altura',
  'ciudad': 'ciudad',
  'nacionalidad': 'nacionalidad',
  'fecha de asociado': 'fechaDeAsociado',
  'estado': 'estado',
  'activo adherente baja': 'estado',
  'condicion obs': 'condicionObs',
  'correo electronico': 'correoElectronico',
  'email': 'correoElectronico',
  'e mail': 'correoElectronico',
  'telefono': 'telefono',
  'n de telefono': 'telefono',
  'telefono emergencia': 'telefonoEmergencia',
  'observaciones': 'observaciones',
  'clubid': 'clubId',
  'club id': 'clubId',
  'club': 'clubId',
};

const parseDateValue = (value) => {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

export const columnsToSocioData = (headerRow, valuesRow) => {
  const record = {};
  const headers = headerRow.map(normalizeHeader);

  headers.forEach((rawHeader, index) => {
    const field = headerMap[rawHeader];
    if (!field) return;
    const value = valuesRow[index] ?? '';
    if (field === 'fechaNacimiento' || field === 'fechaDeAsociado') {
      record[field] = parseDateValue(value);
    } else {
      record[field] = value?.toString().trim();
    }
  });

  return record;
};

const getSocioSheetConfig = () => ({
  spreadsheetId: process.env.GOOGLE_SHEETS_SOCIOS_ID,
  sheetName: process.env.GOOGLE_SHEETS_SOCIOS_SHEET_NAME || 'Socios',
});

const saveSheetMetadata = async (socio, { spreadsheetId, sheetName, rowNumber } = {}) => {
  if (rowNumber) {
    socio.sheetRowNumber = rowNumber;
    socio.sheetName = sheetName;
    socio.spreadsheetId = spreadsheetId;
  }
  socio.sheetUpdatedAt = new Date();
  await socio.save();
};

export const syncSocioToSheet = async (socio, { appendIfMissing = true, deleted = false } = {}) => {
  const { spreadsheetId, sheetName } = getSocioSheetConfig();
  if (!spreadsheetId) return socio;

  const sheetRow = buildSocioSheetRow(socio);
  if (deleted) sheetRow.push('BAJA');

  if (socio.sheetRowNumber) {
    await updateSheetRow(spreadsheetId, sheetName, socio.sheetRowNumber, sheetRow);
    await saveSheetMetadata(socio);
    return socio;
  }

  if (!appendIfMissing) return socio;

  const { rowNumber } = await appendToSheet(spreadsheetId, `${sheetName}!A:Z`, sheetRow);
  if (rowNumber) {
    await saveSheetMetadata(socio, { spreadsheetId, sheetName, rowNumber });
  }

  return socio;
};
