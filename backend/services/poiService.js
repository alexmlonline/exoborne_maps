const db = require('../config/database');

class PoiService {
    // Get all approved POIs
    async getApprovedPois() {
        const [rows] = await db.query('SELECT * FROM pois WHERE approved = TRUE');
        return rows;
    }

    // Get all draft POIs
    async getDraftPois() {
        const [rows] = await db.query('SELECT * FROM pois WHERE approved = FALSE');
        return rows;
    }

    // Save or update a POI
    async savePoi(poi) {
        const { id, name, type, description, x, y, visible, approved, dateAdded, lastEdited, sessionId } = poi;
        
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

        const [result] = await db.query(query, [
            id, name, type, description, x, y, visible, approved, dateAdded, lastEdited, sessionId
        ]);

        return result;
    }

    // Delete a POI
    async deletePoi(id, sessionId, canEdit) {
        // First get the POI to check permissions
        const [poi] = await db.query('SELECT * FROM pois WHERE id = ?', [id]);
        
        if (!poi.length) {
            throw new Error('POI not found');
        }

        const poiData = poi[0];

        // Check if the POI is approved
        if (poiData.approved) {
            throw new Error('Cannot delete approved POIs');
        }

        // Check permissions
        if (!canEdit && poiData.sessionId && poiData.sessionId !== sessionId) {
            throw new Error('You can only delete POIs that you created in this session');
        }

        // Delete the POI
        const [result] = await db.query('DELETE FROM pois WHERE id = ?', [id]);
        return result;
    }

    // Approve a POI
    async approvePoi(id, canEdit) {
        if (!canEdit) {
            throw new Error('You do not have permission to approve POIs');
        }

        const [result] = await db.query(
            'UPDATE pois SET approved = TRUE, sessionId = NULL WHERE id = ?',
            [id]
        );

        return result;
    }

    // Get POI by ID
    async getPoiById(id) {
        const [rows] = await db.query('SELECT * FROM pois WHERE id = ?', [id]);
        return rows[0];
    }
}

module.exports = new PoiService(); 