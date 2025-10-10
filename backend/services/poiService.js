const db = require('../config/database');

// Helper function to format date for MySQL
function formatDateForMySQL(dateString) {
    if (!dateString) return new Date().toISOString().slice(0, 19).replace('T', ' ');
    // Remove timezone information and convert to MySQL datetime format
    return new Date(dateString).toISOString().slice(0, 19).replace('T', ' ');
}

class PoiService {
    // Get all approved POIs (optionally filtered by mapId)
    async getApprovedPois(mapId) {
        let sql = 'SELECT * FROM pois WHERE approved = TRUE AND isDeleted = FALSE';
        const params = [];
        if (mapId !== undefined && mapId !== null) {
            sql += ' AND mapId = ?';
            params.push(Number(mapId));
        }
        const [rows] = await db.query(sql, params);
        return rows;
    }

    // Get all draft POIs (optionally filtered by mapId)
    async getDraftPois(mapId) {
        let sql = 'SELECT * FROM pois WHERE approved = FALSE AND isDeleted = FALSE';
        const params = [];
        if (mapId !== undefined && mapId !== null) {
            sql += ' AND mapId = ?';
            params.push(Number(mapId));
        }
        const [rows] = await db.query(sql, params);
        return rows;
    }

    // Save or update a POI
    async savePoi(poi) {
        const { id, name, type, description, x, y, visible, approved, dateAdded, lastEdited, sessionId, mapId } = poi;
        
        const query = `
            INSERT INTO pois (id, name, type, description, x, y, visible, approved, dateAdded, lastEdited, sessionId, isDeleted, mapId)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, FALSE, ?)
            ON DUPLICATE KEY UPDATE
                name = VALUES(name),
                type = VALUES(type),
                description = VALUES(description),
                x = VALUES(x),
                y = VALUES(y),
                visible = VALUES(visible),
                approved = VALUES(approved),
                lastEdited = VALUES(lastEdited),
                sessionId = VALUES(sessionId),
                isDeleted = FALSE,
                mapId = VALUES(mapId)
        `;

        const values = [
            id,
            name,
            type,
            description || '',
            x,
            y,
            visible,
            approved,
            formatDateForMySQL(dateAdded),
            lastEdited ? formatDateForMySQL(lastEdited) : null,
            sessionId || null,
            mapId || null
        ];

        const [result] = await db.query(query, values);
        return result;
    }

    // Soft delete a POI
    async deletePoi(id, sessionId, isAdmin) {
        // First get the POI to check permissions
        const [poi] = await db.query('SELECT * FROM pois WHERE id = ? AND isDeleted = FALSE', [id]);
        
        if (!poi.length) {
            throw new Error('POI not found');
        }

        const poiData = poi[0];

        // Check if the POI is approved
        if (poiData.approved && !isAdmin) {
            throw new Error('Cannot delete approved POIs without admin privileges');
        }

        // Check permissions
        if (!isAdmin && poiData.sessionId && poiData.sessionId !== sessionId) {
            throw new Error('You can only delete POIs that you created in this session');
        }

        // Soft delete the POI
        const [result] = await db.query('UPDATE pois SET isDeleted = TRUE WHERE id = ?', [id]);
        return result;
    }

    // Approve a POI
    async approvePoi(id, isAdmin) {
        if (!isAdmin) {
            throw new Error('You do not have permission to approve POIs');
        }

        const [result] = await db.query(
            'UPDATE pois SET approved = TRUE, sessionId = NULL WHERE id = ? AND isDeleted = FALSE',
            [id]
        );

        return result;
    }

    // Get POI by ID
    async getPoiById(id) {
        const [rows] = await db.query('SELECT * FROM pois WHERE id = ? AND isDeleted = FALSE', [id]);
        return rows[0];
    }

    // Restore a deleted POI (admin only)
    async restorePoi(id, isAdmin) {
        if (!isAdmin) {
            throw new Error('You do not have permission to restore POIs');
        }

        const [result] = await db.query(
            'UPDATE pois SET isDeleted = FALSE WHERE id = ?',
            [id]
        );

        return result;
    }
}

module.exports = new PoiService(); 