const { Client } = require('pg');

module.exports = {
  up: async (client) => {
    await client.query(`
      ALTER TABLE rep 
      ADD COLUMN IF NOT EXISTS estado VARCHAR(20) DEFAULT 'Activo';
    `);
  },

  down: async (client) => {
    await client.query(`
      ALTER TABLE rep 
      DROP COLUMN IF EXISTS estado;
    `);
  }
};
