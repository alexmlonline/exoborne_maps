const fs = require('fs');
const path = require('path');
const db = require('../config/database');

// Helper function to format date for MySQL
function formatDateForMySQL(dateString) {
    if (!dateString) return new Date().toISOString().slice(0, 19).replace('T', ' ');
    // Remove timezone information and convert to MySQL datetime format
    return new Date(dateString).toISOString().slice(0, 19).replace('T', ' ');
}

async function migrateData() {
    try {
        console.log('Starting migration...');

        // Read JSON files
        const approvedPoisPath = path.join(__dirname, '../../pois/pois.json');
        const draftPoisPath = path.join(__dirname, '../../pois/pois-draft.json');

        const approvedPois = JSON.parse(fs.readFileSync(approvedPoisPath, 'utf8'));
        const draftPois = JSON.parse(fs.readFileSync(draftPoisPath, 'utf8'));

        console.log(`Found ${approvedPois.length} approved POIs and ${draftPois.length} draft POIs`);

        // Prepare the insert query
        const query = `
            INSERT INTO pois (id, name, type, description, x, y, visible, approved, dateAdded, lastEdited, sessionId)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                name = VALUES(name),
                type = VALUES(type),
                description = VALUES(description),
                x = VALUES(x),
                y = VALUES(y),
                visible = VALUES(visible),
                approved = VALUES(approved),
                lastEdited = VALUES(lastEdited),
                sessionId = VALUES(sessionId)
        `;

        // Process approved POIs
        console.log('Migrating approved POIs...');
        for (const poi of approvedPois) {
            const values = [
                poi.id,
                poi.name,
                poi.type,
                poi.description || '',
                poi.x,
                poi.y,
                poi.visible,
                true, // approved POIs
                formatDateForMySQL(poi.dateAdded),
                poi.lastEdited ? formatDateForMySQL(poi.lastEdited) : null,
                null // approved POIs don't have sessionId
            ];
            await db.query(query, values);
        }

        // Process draft POIs
        console.log('Migrating draft POIs...');
        for (const poi of draftPois) {
            const values = [
                poi.id,
                poi.name,
                poi.type,
                poi.description || '',
                poi.x,
                poi.y,
                poi.visible,
                false, // draft POIs
                formatDateForMySQL(poi.dateAdded),
                poi.lastEdited ? formatDateForMySQL(poi.lastEdited) : null,
                poi.sessionId || null
            ];
            await db.query(query, values);
        }

        // Verify the migration
        const [approvedCount] = await db.query('SELECT COUNT(*) as count FROM pois WHERE approved = TRUE');
        const [draftCount] = await db.query('SELECT COUNT(*) as count FROM pois WHERE approved = FALSE');

        console.log('\nMigration completed successfully!');
        console.log(`Total POIs in database: ${approvedCount[0].count + draftCount[0].count}`);
        console.log(`- Approved POIs: ${approvedCount[0].count}`);
        console.log(`- Draft POIs: ${draftCount[0].count}`);

    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    } finally {
        // Close the database connection
        await db.end();
    }
}

// Run the migration
migrateData(); 