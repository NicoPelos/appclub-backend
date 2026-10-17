// Replica set initialization script for MongoDB transactions.
// This script is executed by MongoDB on first startup when the data directory is empty.
try {
  const config = {
    _id: 'rs0',
    members: [{ _id: 0, host: 'mongo:27017' }],
  };

  print('Initializing MongoDB replica set rs0...');
  const result = rs.initiate(config);
  printjson(result);
  print('Replica set initialization complete.');
} catch (error) {
  print('Replica set initialization skipped or failed: ' + error);
}
