import { google } from 'googleapis';
import dotenv from 'dotenv';

dotenv.config();

// Configuración de autenticación (requiere archivo de credenciales de Service Account)
const auth = new google.auth.GoogleAuth({
  keyFile: 'google-credentials.json',
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const sheets = google.sheets({ version: 'v4', auth });

const parseUpdatedRangeRow = (updatedRange) => {
  if (!updatedRange) return null;
  const match = updatedRange.match(/![A-Z]+([0-9]+)(?::[A-Z]+[0-9]+)?$/);
  return match ? Number(match[1]) : null;
};

// Restaurada (appcarc-backend#263): un refactor la había borrado por
// "no utilizado", pero knip no conoce scripts/*.js como entry points y
// no detectó que 4 scripts de importación registrados en package.json
// (import-socios, import-cuotas, import-horarios, import-movimientos)
// la siguen necesitando — quedaron rotos desde entonces hasta este fix.
export const getSheetValues = async (spreadsheetId, range) => {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
    });
    return response.data.values || [];
  } catch (error) {
    console.error('Error leyendo Google Sheets:', error);
    return [];
  }
};

export const appendToSheet = async (spreadsheetId, range, values) => {
  try {
    const response = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      resource: { values: [values] },
    });

    const rowNumber = parseUpdatedRangeRow(response.data.updates?.updatedRange);
    return { rowNumber, updatedRange: response.data.updates?.updatedRange };
  } catch (error) {
    console.error('Error sincronizando con Google Sheets:', error);
    return { rowNumber: null, updatedRange: null };
  }
};

export const updateSheetRow = async (spreadsheetId, sheetName, rowNumber, values) => {
  try {
    const range = `${sheetName}!A${rowNumber}`;
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [values] },
    });
  } catch (error) {
    console.error('Error actualizando Google Sheets:', error);
  }
};