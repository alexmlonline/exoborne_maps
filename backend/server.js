const express = require('express');


// Load environment variables from .env file BEFORE other imports
// This ensures environment variables are available to all modules
try {
    const dotenv = require('dotenv');
    dotenv.config();
} catch (error) {
    console.error('Failed to load dotenv:', error);
    throw error;
}

const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');
const poiService = require('./services/poiService');


console.log('Environment variables loaded from .env file');
// Debug: Print loaded environment variables (without showing full values for security)
console.log('Environment variables found:');

console.log('- DB_HOST:',process.env.DB_HOST);
console.log('- DB_USER:',process.env.DB_USER);
console.log('- DB_PASSWORD:',process.env.DB_PASSWORD?.slice(0, 3));
console.log('- DB_NAME:',process.env.DB_NAME);


if (process.env.JWT_SECRET) {
    console.log('- JWT_SECRET: [Set]');
} else {
    console.log('- JWT_SECRET: [Not set]');
}

if (process.env.ADMIN_PASSWORD) {
    console.log('- ADMIN_PASSWORD: [Set]');
} else {
    console.log('- ADMIN_PASSWORD: [Not set]');
}

console.log('- NODE_ENV:', process.env.NODE_ENV || '[Not set]');
console.log('- PORT:', process.env.PORT || '[Not set]');


// Import secrets config AFTER environment variables are loaded
const secretsConfig = require('./config/keyVault');

// Create Express app
const app = express();

// Initialize with empty values, will be updated from environment variables
let JWT_SECRET = '';
let ADMIN_PASSWORD = '';

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

// Initialize secrets from environment variables before starting the server
async function initializeApp() {
    try {
        // Retrieve secrets from environment variables
        const secrets = await secretsConfig.initializeSecrets();
        
        // Set the secrets
        JWT_SECRET = secrets.JWT_SECRET;
        ADMIN_PASSWORD = secrets.ADMIN_PASSWORD;
        
        if (JWT_SECRET && ADMIN_PASSWORD) {
            console.log('Secrets loaded successfully from environment variables');
        } else {
            console.warn('Some secrets are missing. Authentication features may not work properly.');
            
            if (!JWT_SECRET) {
                console.warn('JWT_SECRET is not set. Admin authentication will not work.');
            }
            
            if (!ADMIN_PASSWORD) {
                console.warn('ADMIN_PASSWORD is not set. Admin login will not work.');
            }
        }
        
        // Start server after attempting to load secrets
        startServer();
    } catch (error) {
        console.error('Warning: Failed to initialize secrets:', error);
        console.warn('Starting server with limited functionality. Authentication features may not work.');
        
        // Start server anyway with empty secrets
        startServer();
    }
}

// Get approved POIs
app.get('/api/pois-approved', async (req, res) => {
    try {
        const pois = await poiService.getApprovedPois();
        res.json(pois);
    } catch (err) {
        console.error('Error getting approved POIs:', err);
        res.status(500).json({ error: 'Error getting approved POIs' });
    }
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
        // Check if the request has admin token
        const authHeader = req.headers.authorization;
        const token = authHeader && authHeader.split(' ')[1] || poi.token;
        let isAdmin = false;
        
        if (token && JWT_SECRET) {
            try {
                // Verify token
                jwt.verify(token, JWT_SECRET);
                isAdmin = true;
            } catch (err) {
                console.log('Invalid token provided for save operation');
                // Continue without admin privileges
            }
        }
        
        // Ensure approved status is false for draft POIs
        poi.approved = false;
        
        // Add admin status to the POI
        poi.isAdmin = isAdmin;

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

    const { id, sessionId } = req.body;
    if (!id) {
        return res.status(400).json({ success: false, error: 'POI ID is required' });
    }

    // Session ID is required for validation
    if (!sessionId) {
        return res.status(400).json({ success: false, error: 'Session ID is required' });
    }

    try {
        // Check if the request has admin token
        const authHeader = req.headers.authorization;
        const token = authHeader && authHeader.split(' ')[1] || req.body.token;
        let isAdmin = false;
        
        if (token && JWT_SECRET) {
            try {
                // Verify token
                jwt.verify(token, JWT_SECRET);
                isAdmin = true;
            } catch (err) {
                console.log('Invalid token provided for delete operation');
                // Continue without admin privileges
            }
        }
        
        await poiService.deletePoi(id, sessionId, isAdmin);
        
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

    // Get token from Authorization header or from the request body
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1] || req.body.token;
    
    if (!token) {
        return res.status(401).json({ 
            success: false, 
            error: 'Authentication token is required for this operation' 
        });
    }
    
    // Check if JWT_SECRET is configured
    if (!JWT_SECRET) {
        return res.status(500).json({
            success: false,
            error: 'Authentication is not properly configured on the server'
        });
    }
    
    try {
        // Verify token
        jwt.verify(token, JWT_SECRET);
        
        // If token is valid, proceed with approval
        await poiService.approvePoi(poi.id, true);
        
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
        if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
            console.error('Token verification failed:', err);
            return res.status(403).json({ 
                success: false, 
                error: 'Invalid or expired token' 
            });
        }
        
        console.error('Error approving POI:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Endpoint for admin authentication
app.post('/api/admin-auth', async (req, res) => {
  console.log('Received admin authentication request');
  
  const { password } = req.body;
  if (!password) {
    return res.status(400).json({ 
      success: false, 
      error: 'Password is required' 
    });
  }
  
  // Check if authentication is configured
  if (!ADMIN_PASSWORD || !JWT_SECRET) {
    return res.status(500).json({
      success: false,
      error: 'Authentication is not properly configured on the server'
    });
  }
  
  // Validate password
  if (password !== ADMIN_PASSWORD) {
    console.log('Invalid admin password attempt');
    return res.status(401).json({ 
      success: false, 
      error: 'Invalid password' 
    });
  }
  
  // Generate JWT token
  const token = jwt.sign(
    { 
      role: 'admin',
      timestamp: Date.now()
    }, 
    JWT_SECRET, 
    { expiresIn: '24h' } // Token expires in 24 hours
  );
  
  console.log('Admin authentication successful');
  res.json({ 
    success: true, 
    message: 'Authentication successful',
    token
  });
});

// Middleware to verify admin token
const verifyAdminToken = (req, res, next) => {
  // Get token from Authorization header or query parameter
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1] || req.query.token;
  
  if (!token) {
    return res.status(401).json({ 
      success: false, 
      error: 'Access token is required' 
    });
  }
  
  // Check if JWT_SECRET is configured
  if (!JWT_SECRET) {
    return res.status(500).json({
      success: false,
      error: 'Authentication is not properly configured on the server'
    });
  }
  
  try {
    // Verify token
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    console.error('Token verification failed:', err);
    return res.status(403).json({ 
      success: false, 
      error: 'Invalid or expired token' 
    });
  }
};

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
});

// Function to start the server
function startServer() {
    const PORT = process.env.PORT || 8080; // Azure Web Apps expects 8080
    const server = app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
        console.log(`Test the server by visiting http://localhost:${PORT}/api/test`);
        
        // Log authentication status
        if (!JWT_SECRET || !ADMIN_PASSWORD) {
            console.warn('\n⚠️  WARNING: Authentication is not fully configured!');
            console.warn('Some features requiring authentication will not work.');
            console.warn('Please set JWT_SECRET and ADMIN_PASSWORD environment variables.\n');
        }
    });

    // Handle graceful shutdown
    process.on('SIGTERM', () => {
        console.log('SIGTERM signal received: closing HTTP server');
        server.close(() => {
            console.log('HTTP server closed');
        });
    });
}

// Initialize the application
initializeApp(); 