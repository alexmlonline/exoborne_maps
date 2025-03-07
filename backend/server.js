const express = require('express');
const cors = require('cors');
const path = require('path');
const poiService = require('./services/poiService');
const app = express();

// Enable CORS for all routes
app.use(cors());

// Middleware to parse JSON bodies
app.use(express.json());

// Serve static files from the root directory
app.use(express.static(path.join(__dirname, '..')));

// Log all requests for debugging
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
});

// Get approved POIs
app.get('/api/pois-approved', async (req, res) => {
    //try {
        const pois = await poiService.getApprovedPois();
        res.json(pois);
    //} catch (err) {
    //    console.error('Error getting approved POIs:', err);
    //    res.status(500).json({ error: 'Error getting approved POIs' });
    //}
});

// Get draft POIs
app.get('/api/pois-draft', async (req, res) => {
    try {
        const pois = await poiService.getDraftPois();
        res.json(pois);
    } catch (err) {
        console.error('Error getting draft POIs:', err);
        res.status(500).json({ error: 'Error getting draft POIs' });
    }
});

// Add echo endpoint
app.get('/pois/echo.json', (req, res) => {
    res.json({ status: 'OK' });
});

// Test endpoint
app.get('/api/test', (req, res) => {
    res.json({ message: 'Server is running!' });
});

// Health check endpoint for Azure
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'healthy' });
});

// Root endpoint - serve the HTML file instead of JSON response
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../default.html'));
});

// Endpoint to save POIs
app.post('/api/save-poi', async (req, res) => {
    console.log('Received POI request:', req.body);

    const poi = req.body;
    if (!poi || !poi.id) {
        console.error('Invalid POI data received');
        return res.status(400).json({ success: false, error: 'Valid POI data is required' });
    }

    try {
        // Ensure approved status is false for draft POIs
        poi.approved = false;

        // Save the POI
        await poiService.savePoi(poi);
        
        // Get updated POIs
        const draftPois = await poiService.getDraftPois();
        
        res.json({ 
            success: true, 
            message: 'POI saved successfully',
            pois: draftPois
        });
    } catch (err) {
        console.error('Error saving POI:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Endpoint to delete POIs
app.post('/api/delete-poi', async (req, res) => {
    console.log('Received POI delete request:', req.body);

    const { id, sessionId, canEdit } = req.body;
    if (!id) {
        return res.status(400).json({ success: false, error: 'POI ID is required' });
    }

    // Session ID is required for validation
    if (!sessionId) {
        return res.status(400).json({ success: false, error: 'Session ID is required' });
    }

    try {
        await poiService.deletePoi(id, sessionId, canEdit);
        
        // Get updated POIs
        const draftPois = await poiService.getDraftPois();
        
        res.json({ 
            success: true, 
            message: 'POI deleted successfully',
            pois: draftPois
        });
    } catch (err) {
        console.error('Error deleting POI:', err);
        if (err.message.includes('not found')) {
            res.status(404).json({ success: false, error: err.message });
        } else if (err.message.includes('permission')) {
            res.status(403).json({ success: false, error: err.message });
        } else {
            res.status(500).json({ success: false, error: err.message });
        }
    }
});

// Endpoint to approve POIs
app.post('/api/approve-poi', async (req, res) => {
    console.log('Received POI approval request:', req.body);

    const poi = req.body;
    if (!poi || !poi.id) {
        console.error('Invalid POI data received for approval');
        return res.status(400).json({ success: false, error: 'Valid POI data is required' });
    }

    // Check if the request has edit permission
    const canEditFromBody = poi.canEdit === '1';
    const canEditFromQuery = req.query.canEdit === '1';
    const hasEditPermission = canEditFromBody || canEditFromQuery;
    
    if (!hasEditPermission) {
        return res.status(403).json({ 
            success: false, 
            error: 'You do not have permission to approve POIs' 
        });
    }

    try {
        await poiService.approvePoi(poi.id, hasEditPermission);
        
        // Get updated POIs
        const draftPois = await poiService.getDraftPois();
        const approvedPois = await poiService.getApprovedPois();
        
        res.json({ 
            success: true, 
            message: 'POI approved successfully',
            draftPois: draftPois,
            approvedPois: approvedPois
        });
    } catch (err) {
        console.error('Error approving POI:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
});

// Start server
const PORT = process.env.PORT || 8080; // Azure Web Apps expects 8080
const server = app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Test the server by visiting http://localhost:${PORT}/api/test`);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing HTTP server');
    server.close(() => {
        console.log('HTTP server closed');
    });
}); 