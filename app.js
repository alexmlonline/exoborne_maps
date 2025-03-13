// Global offsets
let offsetX = 602; // Change this to your desired X offset
let offsetY = -248; // Change this to your desired Y offset

// Configuration
// Determine if we're running locally or in production (Azure)
const isLocalhost = window.location.hostname === 'localhost' || 
                    window.location.hostname === '127.0.0.1' ||
                    window.location.hostname.includes('192.168.');

// Use localhost URL for local development, just '/api' for production
const API_ENDPOINT = isLocalhost ? 'http://localhost:8080/api' : window.location.origin + '/api';

const MAP_WIDTH = 2000;
const MAP_HEIGHT = 1430;
const STORAGE_KEY = 'game_map_pois';
const SESSION_KEY = 'game_map_session';
const DEFAULT_ZOOM = 1;

// Image preloading flags
let heatmapImagePreloaded = false;
let guideImagePreloaded = false;

// State management
let pois = [];
let sessionId = '';
let isHeatmapVisible = false;
let isGuideVisible = false;

let currentZoom = DEFAULT_ZOOM;
let isDragging = false;
let dragStart = { x: 0, y: 0 };
let mapPosition = { x: 0, y: 0 };
let addMode = false;
let tempPoi = null;
let selectedPoi = null;
let lastSyncTime = 0;

// Add a new global variable to store multiple selected POIs
let selectedPois = [];
// Maximum number of POIs that can be selected at once
const MAX_SELECTED_POIS = 10;

// Format coordinate with sign and padding
const formatCoordinate = (value) => {
  const roundedValue = Math.round(value);
  const sign = roundedValue >= 0 ? '+' : '-';
  return sign + String(Math.abs(roundedValue)).padStart(4, '0');
};

// Check if user has edit permissions based on JWT token
function hasEditPermission() {
  const token = localStorage.getItem('admin_token');
  if (!token) return false;
  
  try {
    // Check if token is expired
    const payload = JSON.parse(atob(token.split('.')[1]));
    const expiryTime = payload.exp * 1000; // Convert to milliseconds
    
    if (Date.now() > expiryTime) {
      // Token expired, remove it
      localStorage.removeItem('admin_token');
      return false;
    }
    
    return true;
  } catch (error) {
    console.error('Error validating token:', error);
    localStorage.removeItem('admin_token');
    return false;
  }
}

// Show admin login modal
function showAdminLoginModal() {
  // Create modal if it doesn't exist
  if ($('#admin-login-modal').length === 0) {
    const modalHtml = `
      <div id="admin-login-modal" class="modal">
        <div class="modal-content">
          <div class="modal-header">
            <h2 class="modal-title">Admin Authentication</h2>
            <button class="modal-close" id="admin-modal-close">&times;</button>
          </div>
          <div class="modal-body">
            <div id="admin-login-error" class="warning-message" style="display: none;"></div>
            <div class="admin-login-form">
              <div class="form-field">
                <label for="admin-password">Admin Password:</label>
                <input type="password" id="admin-password" placeholder="Enter admin password" autocomplete="off">
                <div class="password-info" style="margin-top: 5px; font-size: 11px; color: #aaa;">
                  Password is securely transmitted and verified on the server.
                </div>
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <button id="admin-login-btn-submit" class="confirm-btn">Login</button>
            <button id="admin-cancel-btn" class="cancel-btn">Cancel</button>
          </div>
        </div>
      </div>
    `;
    $('body').append(modalHtml);
    
    // Set up event handlers
    $('#admin-login-btn-submit').on('click', authenticateAdmin);
    $('#admin-cancel-btn, #admin-modal-close').on('click', function() {
      $('#admin-login-modal').hide();
      $('#admin-password').val('');
      $('#admin-login-error').hide();
    });
    
    // Close when clicking outside the modal content
    $('#admin-login-modal').on('click', function(event) {
      if (event.target === this) {
        $('#admin-login-modal').hide();
        $('#admin-password').val('');
        $('#admin-login-error').hide();
      }
    });
    
    // Handle Enter key press
    $('#admin-password').on('keypress', function(e) {
      if (e.which === 13) {
        authenticateAdmin();
      }
    });
  }
  
  // Show the modal
  $('#admin-login-modal').show();
  $('#admin-password').focus();
}

// Authenticate admin with server
function authenticateAdmin() {
  const password = $('#admin-password').val();
  
  if (!password) {
    $('#admin-login-error').text('Please enter a password').show();
    return;
  }
  
  // Show loading state
  $('#admin-login-btn-submit').prop('disabled', true).text('Authenticating...');
  
  // Send authentication request to server
  fetch(`${API_ENDPOINT}/admin-auth`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ password }),
  })
  .then(response => {
    if (!response.ok) {
      throw new Error(`Server returned ${response.status}: ${response.statusText}`);
    }
    return response.json();
  })
  .then(data => {
    if (data.success) {
      // Store token in localStorage
      localStorage.setItem('admin_token', data.token);
      
      // Hide modal
      $('#admin-login-modal').hide();
      $('#admin-password').val('');
      $('#admin-login-error').hide();
      
      // Show success notification
      showNotification('Admin authentication successful');
      
      // Refresh the UI to show admin controls
      updateAdminUIState();
    } else {
      $('#admin-login-error').text(data.error || 'Authentication failed').show();
    }
  })
  .catch(error => {
    console.error('Authentication error:', error);
    $('#admin-login-error').text('Authentication failed: ' + error.message).show();
  })
  .finally(() => {
    // Reset button state
    $('#admin-login-btn-submit').prop('disabled', false).text('Login');
  });
}

// Logout admin
function logoutAdmin() {
  localStorage.removeItem('admin_token');
  showNotification('Admin logged out successfully');
  updateAdminUIState();
}

// Function to check if a POI belongs to the current session
function isOwnedByCurrentSession(poiId) {
  const poi = pois.find(p => p.id === poiId);
  return poi && poi.sessionId === sessionId;
}

// Function to check if user can edit a specific POI
function canEditPoi(poiId) {
  return hasEditPermission() || isOwnedByCurrentSession(poiId);
}

// Update the context menu HTML structure
function updateContextMenuHtml() {
  const isAdmin = hasEditPermission();
  const selectedPoiObj = pois.find(p => p.id === selectedPoi);
  const isOwner = selectedPoiObj && selectedPoiObj.sessionId === sessionId;
  const canEdit = isAdmin || isOwner;
  const canDeleteInSession = isOwner && selectedPoiObj && !selectedPoiObj.approved;
  
  // Check if this is a new POI creation (no selectedPoi) or editing an existing POI
  const isNewPoi = !selectedPoi;
  
  $('#context-menu').html(`
    <div class="context-menu-form">
      <div class="context-menu-field">
        <label for="context-poi-type" style="display: inline-block;">Type:</label>
        <span id="context-coordinates" style="display: inline-block; margin-left: 10px; color: #ccc; font-size: inherit;">X: 0, Y: 0</span>
        <select id="context-poi-type">
          <option value="shelter">Rebirth Shelter</option>
          <option value="bunker">Rebirth Bunker</option>
          <option value="fragment">Clearance Fragment</option>
          <option value="machinery">EC Kits/Machinery Parts</option>
          <option value="machinery" style="display: none;">Machinery Parts</option>
          <option value="electronics">Electronics</option>
          <option value="secret">Secret</option>
          <option value="ec-kits" style="display: none;">EC Kits</option>
          <option value="collectibles">Collectibles</option>
          <option value="jewelries">Jewelries</option>
          <option value="loot">Loot</option>
          <option value="container">Locked Containers</option>
          <option value="respawn">Respawn</option>
          <option value="distilleries">Botkin Distilleries</option>
          <option value="emp-jammer">EMP Jammer</option>
        </select>
      </div>
      <div class="context-menu-field">
        <label for="context-poi-note">Note:</label>
        <textarea id="context-poi-note" placeholder="Add a note about this POI (shown on hover)"></textarea>
      </div>
      <div class="context-menu-buttons">
        ${isNewPoi || canEdit ? '<button id="context-save-btn">Save</button>' : ''}
        ${(isAdmin || canDeleteInSession) ? '<button id="context-delete-btn" style="background-color: #f44336;">Delete</button>' : ''}
        ${isAdmin && selectedPoiObj && !selectedPoiObj.approved ? '<button id="context-approve-btn" style="background-color: #4CAF50;">Approve</button>' : ''}
        <button id="context-cancel-btn">Cancel</button>
        ${canDeleteInSession ? '<span style="margin-left: 10px; font-size: 11px; color: #4CAF50;">✓ Your POI</span>' : ''}
        ${isAdmin ? '<span style="margin-left: 10px; font-size: 11px; color: #4CAF50;">👑 Admin</span>' : ''}
      </div>
    </div>
  `);

  // Set up event handlers for context menu buttons
  if (!selectedPoi) {
    $('#context-save-btn').off('click').on('click', saveContextMenuPoi);
  } else {
    $('#context-save-btn').off('click').on('click', saveEditedPoi);
  }
  
  $('#context-cancel-btn').off('click').on('click', function () {
    $('#context-menu').hide();
  });

  $('#context-delete-btn').off('click').on('click', function () {
    const poiId = selectedPoi;
    $('#context-menu').hide();
    deletePoi(poiId);
  });

  $('#context-approve-btn').off('click').on('click', function () {
    const poiId = selectedPoi;
    $('#context-menu').hide();
    approvePoi(poiId);
  });

  // Make fields read-only if needed - only for existing POIs, not for new ones
  if (selectedPoi && selectedPoiObj) {
    const isAdmin = hasEditPermission();
    const isOwner = selectedPoiObj.sessionId === sessionId;
    const canEdit = isAdmin || isOwner;
    
    // Disable fields if user can't edit
    $('#context-poi-type').prop('disabled', !canEdit);
    $('#context-poi-note').prop('disabled', !canEdit);
    
    // Add visual styling for read-only fields
    if (!canEdit) {
      // Style for the select dropdown
      $('#context-poi-type').css({
        'background-color': 'transparent',
        'border': '1px solid #ddd',
        'cursor': 'not-allowed',
        'opacity': '1',
        'box-shadow': 'none'
      });
      
      // Style for the textarea
      $('#context-poi-note').css({
        'background-color': 'transparent',
        'border': '1px solid #ddd',
        'color': '#333',
        'cursor': 'not-allowed',
        'opacity': '1',
        'box-shadow': 'none',
        'resize': 'none'  // Prevent resizing in read-only mode
      });
      
      // Add a small lock icon to indicate read-only status
      if (!$('.read-only-indicator').length) {
        const lockIcon = $('<div class="read-only-indicator" style="position: absolute; top: 10px; right: 10px; color: #ff9800; font-size: 16px;">🔒</div>');
        $('.context-menu-form').append(lockIcon);
      }
    } else {
      $('#context-poi-type, #context-poi-note').css({
        'background-color': '',
        'border': '',
        'color': '',
        'cursor': '',
        'opacity': '',
        'box-shadow': '',
        'font-weight': '',
        'resize': ''
      });
      
      // Remove lock icon if it exists
      $('.read-only-indicator').remove();
    }
  } else {
    // For new POIs, always enable fields
    $('#context-poi-type').prop('disabled', false);
    $('#context-poi-note').prop('disabled', false);
    $('#context-poi-type, #context-poi-note').css({
      'background-color': '',
      'cursor': '',
      'opacity': ''
    });
  }

  // Prevent clicks inside the context menu from closing it
  $('#context-menu').off('click').on('click', function (e) {
    e.stopPropagation();
  });

  // Set the color of the dropdown
  $('#context-poi-type').on('change', function () {
    const selectedType = $(this).val();
    $(this).css('color', getPoiColor(selectedType));
  });
}

// Initialize the map
function initMap() {
  const mapElement = $('#game-map');
  mapElement.css({
    width: MAP_WIDTH + 'px',
    height: MAP_HEIGHT + 'px',
    transform: `scale(${currentZoom}) translate(${mapPosition.x}px, ${mapPosition.y}px)`
  });

  // Initialize session ID
  initSessionId();

  // Set up overlays with the same dimensions as the main map
  const heatmapOverlay = $('#heatmap-overlay');
  const guideOverlay = $('#guide-overlay');
  
  // Preload the heatmap and guide images in the background
  preloadOverlayImages();
  
  heatmapOverlay.css({
    width: MAP_WIDTH + 'px',
    height: MAP_HEIGHT + 'px',
    backgroundImage: 'url(maps/Maynard_Heatmap_Transparent.png)',
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    opacity: 0.7,
    transform: `scale(${currentZoom}) translate(${mapPosition.x}px, ${mapPosition.y}px)`
  });

  guideOverlay.css({
    width: MAP_WIDTH + 'px',
    height: MAP_HEIGHT + 'px',
    backgroundImage: 'url(maps/Maynard_Guide_Transparent.png)',
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    opacity: 0.9,
    transform: `scale(${currentZoom}) translate(${mapPosition.x}px, ${mapPosition.y}px)`
  });

  // Check URL parameters for initial state
  checkUrlParameters();

  // Center the map initially
  resetMapView();
  
  // Initialize zoom indicator
  updateZoomIndicator();
  
  // Show session management UI
  // showSessionManagement(); // Removed as requested

  // Mouse events for dragging
  mapElement.on('mousedown', startDragging);
  $(document).on('mousemove', dragMap);
  $(document).on('mouseup', stopDragging);

  // Map controls
  $('#zoom-in').on('click', () => {
    const containerWidth = $('#map-container').width();
    const containerHeight = $('#map-container').height();
    changeZoom(0.2, containerWidth / 2, containerHeight / 2);
  });

  $('#zoom-out').on('click', () => {
    const containerWidth = $('#map-container').width();
    const containerHeight = $('#map-container').height();
    changeZoom(-0.2, containerWidth / 2, containerHeight / 2);
  });

  $('#reset-view').on('click', resetMapView);

  // Heatmap toggle
  $('#toggle-heatmap').on('click', toggleHeatmap);

  // Guide toggle
  $('#toggle-guide').on('click', toggleGuide);

  // POI controls
  $('#add-mode-btn').on('click', toggleAddMode);
  $('#refresh-btn').on('click', function() {
    syncWithServer(true).then(() => {
      // Process URL selected POIs after sync is complete
      processUrlSelectedPois();
    });
  });
  $('#save-poi-btn').on('click', savePoi);
  $('#cancel-poi-btn').on('click', cancelAddPoi);
  $('#session-btn').on('click', showSessionManagement);
  
  // Add event handler for the new session link
  $(document).on('click', '#create-new-session', function(e) {
    e.preventDefault();
    if (confirm('Starting a new session will prevent you from deleting POIs created in previous sessions. Continue?')) {
      // Generate a new session ID
      sessionId = 'session-' + Date.now() + '-' + Math.random().toString(36).substring(2, 15);
      localStorage.setItem(SESSION_KEY, sessionId);
      showNotification('New session started. You can now create and delete new POIs.');
      renderPois(); // Re-render to update session indicators
    }
  });

  // Initialize the context menu
  updateContextMenuHtml();

  // Load POIs
  //loadPoisFromStorage();
  loadPoisFromFile();
  syncWithServer().then(() => {
    // Additional actions after sync if needed
  });
}

function loadPoisFromFile() {
  // Reset URL processing flag
  window.urlPoisProcessed = false;
  
  showNotification('Loading POIs from server...');
  
  // Store the current state of preserveUnapprovedOnly flag
  const showingOnlyUnapproved = window.preserveUnapprovedOnly;
  
  // Load both approved and draft POIs
  Promise.all([
    // Load approved POIs
    $.ajax({
      url: `${API_ENDPOINT}/pois-approved`,
      method: 'GET',
      dataType: 'json'
    }).catch(error => {
      console.error('Error loading approved POIs:', error);
      showNotification('Error loading approved POIs', true);
      return []; // Return empty array if file doesn't exist or has error
    }),
    
    // Load draft POIs
    $.ajax({
      url: `${API_ENDPOINT}/pois-draft`,
      method: 'GET',
      dataType: 'json'
    }).catch(error => {
      console.error('Error loading draft POIs:', error);
      showNotification('Error loading draft POIs', true);
      return []; // Return empty array if file doesn't exist or has error
    })
  ])
  .then(([approvedPois, draftPois]) => {
    // Process the POIs to ensure they have approval status and remove any action property
    const processedApproved = approvedPois.map(poi => {
      // Remove action property and sessionId if they exist
      const { action, sessionId, ...cleanPoi } = poi;
      return {
        ...cleanPoi,
        approved: true // Ensure approved status for main POIs
      };
    });

    const processedDraft = draftPois.map(poi => {
      // Remove action property if it exists
      const { action, ...cleanPoi } = poi;
      return {
        ...cleanPoi,
        approved: false // Ensure unapproved status for draft POIs
      };
    });

    // Check if we should skip rendering POIs due to URL processing
    const skipRendering = window.urlPoisProcessed;

    // Create a map to track POIs by ID to avoid duplicates
    const poiMap = new Map();
    
    // Add approved POIs first
    processedApproved.forEach(poi => {
      poiMap.set(poi.id, poi);
    });
    
    // Add draft POIs, which will override any approved POIs with the same ID
    processedDraft.forEach(poi => {
      poiMap.set(poi.id, poi);
    });
    
    // Convert map back to array
    pois = Array.from(poiMap.values());
    
    // Check if we need to restore the "show unapproved only" state
    if (showingOnlyUnapproved) {
      // Set visibility for POIs - only show unapproved
      pois.forEach(poi => {
        poi.visible = !poi.approved;
      });
      
      // Uncheck all group checkboxes to reflect that we're not using the normal filtering
      $('.group-checkbox').prop('checked', false);
      
      showNotification('Showing only unapproved POIs');
    }
    
    // Only render POIs if we're not skipping rendering
    if (!skipRendering) {
      renderPois();
      savePoisToStorage();
    }
    
    // Update last sync time
    lastSyncTime = Date.now();
    
    showNotification(`Loaded ${pois.length} POIs successfully`);
    
    // Update groups from URL after POIs are loaded
    // Only do this if we're not showing only unapproved POIs
    if (!showingOnlyUnapproved) {
      updateGroupsFromUrl();
    }
    
    // Process URL selected POIs after POIs are loaded
    processUrlSelectedPois();
    
    // Clear the flag after all operations are complete
    window.preserveUnapprovedOnly = false;
  })
  .catch(error => {
    console.error('Error in POI loading process:', error);
    showNotification('Error loading POIs from server', true);
    
    // Clear the flag in case of error
    window.preserveUnapprovedOnly = false;
  });
}

// Map interaction functions
function startDragging(e) {
  // Don't start dragging if the right mouse button is pressed (for context menu)
  if (e.which === 3) {
    return;
  }
  
  // Don't start dragging if we're in add mode
  if (addMode) {
    // In add mode, clicking creates a POI instead of dragging
    const mapOffset = $('#game-map').offset();
    const clickX = (e.pageX - mapOffset.left) / currentZoom;
    const clickY = (e.pageY - mapOffset.top) / currentZoom;

    // Apply the offsets and scaling factor for the form
    const mapX = Math.round(clickX);
    const mapY = Math.round(clickY - MAP_HEIGHT);
    const adjustedX = (mapX - offsetX) * 1.664;
    const adjustedY = (mapY - offsetY) * 1.664;

    // Set the coordinates in the form
    $('#poi-x').val(formatCoordinate(adjustedX));
    $('#poi-y').val(formatCoordinate(adjustedY));

    // Show the form
    $('#poi-form').show();
    $('#poi-type').focus();
    
    return;
  }

  isDragging = true;
  dragStart = {
    x: e.pageX - mapPosition.x * currentZoom,
    y: e.pageY - mapPosition.y * currentZoom
  };
  $('#game-map').css('cursor', 'grabbing');
}

function dragMap(e) {
  if (!isDragging) return;

  // Get the new mouse position
  const mouseX = e.pageX;
  const mouseY = e.pageY;

  // Calculate new position based on the drag start point
  mapPosition.x = (mouseX - dragStart.x) / currentZoom;
  mapPosition.y = (mouseY - dragStart.y) / currentZoom;

  // Get container dimensions
  const containerWidth = $('#map-container').width();
  const containerHeight = $('#map-container').height();

  // Apply boundary constraints
  applyMapBoundaryConstraints(containerWidth, containerHeight);

  updateMapTransform();
  
  // Track map dragging with throttling
  trackMapInteraction('drag', {
    deltaX: mouseX - dragStart.x,
    deltaY: mouseY - dragStart.y
  });
}

function stopDragging() {
  isDragging = false;
  $('#game-map').css('cursor', 'default');
}

function changeZoom(delta, cursorX, cursorY) {
  const oldZoom = currentZoom;
  
  const containerWidth = $('#map-container').width();
  const containerHeight = $('#map-container').height();
  
  // Calculate minimum zoom level based on container dimensions
  // This ensures the map always fills at least one dimension of the viewport
  const minZoomWidth = containerWidth / MAP_WIDTH;
  const minZoomHeight = containerHeight / MAP_HEIGHT;
  const minZoom = Math.max(0.2, Math.min(minZoomWidth, minZoomHeight));
  
  // Update zoom with new minimum limit
  currentZoom = Math.max(minZoom, Math.min(4, currentZoom + delta));

  // If cursor position is provided, zoom towards that point
  // Otherwise, zoom towards the center of the viewport
  let centerX, centerY;
  if (cursorX !== undefined && cursorY !== undefined) {
    centerX = cursorX;
    centerY = cursorY;
  } else {
    centerX = containerWidth / 2;
    centerY = containerHeight / 2;
  }

  const centerMapX = centerX / oldZoom - mapPosition.x;
  const centerMapY = centerY / oldZoom - mapPosition.y;

  mapPosition.x = -centerMapX + centerX / currentZoom;
  mapPosition.y = -centerMapY + centerY / currentZoom;

  // Apply boundary constraints
  applyMapBoundaryConstraints(containerWidth, containerHeight);

  updateMapTransform();
  trackEvent('ZoomMap', {
    zoomLevel: currentZoom,
    zoomDelta: delta
  });
  
  // Update zoom level indicator if it exists
  updateZoomIndicator();
}

function updateMapTransform() {
  // Add transition for smoother zooming
  $('#game-map').css({
    'transition': 'transform 0.2s ease-out',
    'transform': `scale(${currentZoom}) translate(${mapPosition.x}px, ${mapPosition.y}px)`
  });
  
  // Apply the same transform to both overlays
  $('#heatmap-overlay, #guide-overlay').css({
    'transition': 'transform 0.2s ease-out',
    'transform': `scale(${currentZoom}) translate(${mapPosition.x}px, ${mapPosition.y}px)`
  });
  
  // Remove transition after a short delay to avoid affecting dragging
  setTimeout(() => {
    $('#game-map').css('transition', 'none');
    $('#heatmap-overlay, #guide-overlay').css('transition', 'none');
  }, 200);
}

function resetMapView() {
  const containerWidth = $('#map-container').width();
  const containerHeight = $('#map-container').height();

  // Calculate minimum zoom level based on container dimensions
  const minZoomWidth = containerWidth / MAP_WIDTH;
  const minZoomHeight = containerHeight / MAP_HEIGHT;
  const minZoom = Math.max(0.2, Math.min(minZoomWidth, minZoomHeight));
  
  // Use the larger of DEFAULT_ZOOM or minZoom
  currentZoom = Math.max(DEFAULT_ZOOM, minZoom);

  // Calculate the center position directly
  // This ensures the map is centered regardless of its size relative to the container
  mapPosition.x = (containerWidth / currentZoom - MAP_WIDTH) / 2;
  mapPosition.y = (containerHeight / currentZoom - MAP_HEIGHT) / 2;
  
  // Apply boundary constraints to ensure the map stays within the viewport
  // This is still needed for cases where the map is larger than the container
  applyMapBoundaryConstraints(containerWidth, containerHeight);

  updateMapTransform();
  updateZoomIndicator();
}

// POI management functions
function toggleAddMode() {
  addMode = !addMode;
  
  if (addMode) {
    $('#add-mode-btn').addClass('active');
    $('#game-map').css('cursor', 'crosshair');
    $('#poi-form').show();
    
    // Force the form to be visible (sometimes jQuery show() doesn't work correctly)
    document.getElementById('poi-form').style.display = 'block';
    
    // Clear form fields
    $('#poi-type').val('shelter');
    $('#poi-x').val('');
    $('#poi-y').val('');
    $('#poi-desc').val('');
    
    // Hide heatmap overlay when adding POIs
    if (isHeatmapVisible) {
      toggleHeatmap();
    }
    
    // Show notification
    showNotification('Add mode enabled. Double-click on the map to add a POI.');
  } else {
    $('#add-mode-btn').removeClass('active');
    $('#game-map').css('cursor', 'default');
    $('#poi-form').hide();
    tempPoi = null;
    
    // Show notification
    showNotification('Add mode disabled.');
  }
}

// Function to format coordinates as strings with signs
const formatCoordinateForStorage = (value) => {
    const roundedValue = Math.round(value);
    const sign = roundedValue >= 0 ? '+' : '-';
    return sign + String(Math.abs(roundedValue)).padStart(4, '0');
};

function savePoi() {
  // Get values from form
  const type = $('#poi-type').val();
  const x = $('#poi-x').val();
  const y = $('#poi-y').val();
  const description = $('#poi-desc').val().trim();
  
  // Validate inputs
  if (!x || !y) {
    showNotification('Please enter both X and Y coordinates', true);
    return;
  }
  
  // Convert coordinates to numbers (removing + sign if present)
  const numX = parseFloat(x.replace(/^\+/, ''));
  const numY = parseFloat(y.replace(/^\+/, ''));
  
  if (isNaN(numX) || isNaN(numY)) {
    showNotification('Invalid coordinates. Please enter valid numbers.', true);
    return;
  }
  
  // Check for nearby POIs one last time
  const nearbyPois = checkForNearbyPois(numX, numY, type);
  if (nearbyPois.length > 0) {
    // Show custom confirmation modal
    showDuplicateConfirmModal(nearbyPois, type, function(confirmed) {
      if (confirmed) {
        // User confirmed, proceed with saving
        createAndSavePoi(type, numX, numY, description);
      }
      // If not confirmed, do nothing
    });
  } else {
    // No nearby POIs, proceed with saving
    createAndSavePoi(type, numX, numY, description);
  }
}

// Helper function to create and save a POI
function createAndSavePoi(type, x, y, description) {
  // Create a new POI object
  const newPoi = {
    id: 'poi-' + Date.now(),
    name: `POI-${Date.now().toString().slice(-4)}`,
    type: type,
    description: description,
    x: x,
    y: y,
    visible: true,
    approved: false,
    dateAdded: new Date().toISOString(),
    sessionId: sessionId
  };
  
  // Save the POI
  saveUnapprovedPoi(newPoi);
}

function cancelAddPoi() {
  // Hide the form
  $('#poi-form').hide();
  
  // Clear temporary POI
  tempPoi = null;
  
  // Disable add mode
  addMode = false;
  
  // Remove active class from button
  $('#add-mode-btn').removeClass('active');
  
  // Reset cursor style
  $('#game-map').css('cursor', 'default');
  
  // Hide the context menu if it's visible
  $('#context-menu').hide();
  
  // Hide the nearby POI warning
  $('#nearby-poi-warning').hide().empty();
  
  // Show notification
  showNotification('Add mode disabled.');
}

function togglePoiVisibility(id) {
  const poi = pois.find(p => p.id === id);
  if (poi) {
    poi.visible = !poi.visible;
    renderPois();
    savePoisToStorage();
  }
}

function selectPoi(id, useCtrlKey = false) {
  // Skip if already selected and not using Ctrl
  if (selectedPoi === id && !useCtrlKey) return;
  
  // Handle multi-selection with Ctrl key
  if (useCtrlKey) {
    const index = selectedPois.indexOf(id);
    
    // If already in the selected list, remove it
    if (index !== -1) {
      selectedPois.splice(index, 1);
      // If this was the only/last selected POI, clear single selection too
      if (selectedPois.length === 0) {
        selectedPoi = null;
      } else {
        // Otherwise set single selection to the last selected POI
        selectedPoi = selectedPois[selectedPois.length - 1];
      }
    } else {
      // If not in the list and we haven't reached the limit, add it
      if (selectedPois.length < MAX_SELECTED_POIS) {
        selectedPois.push(id);
        selectedPoi = id; // Update single selection too
      } else {
        showNotification(`Maximum of ${MAX_SELECTED_POIS} POIs can be selected at once`, true);
        return;
      }
    }
  } else {
    // Regular single selection (no Ctrl key)
    // Always clear previous selection when not using Ctrl key
    selectedPoi = id;
    selectedPois = [id]; // Reset multi-selection to just this POI
  }
  
  // Update the visual state of all POI markers
  $('.poi-marker').removeClass('selected multi-selected');
  
  // Remove highlight from all group headers
  $('.poi-group-header').removeClass('highlighted');
  
  // Apply styling to all selected POIs and highlight their groups
  const selectedTypes = new Set(); // Track unique types of selected POIs
  
  selectedPois.forEach(poiId => {
    const marker = $(`.poi-marker[data-id="${poiId}"]`);
    marker.addClass(poiId === selectedPoi ? 'selected' : 'multi-selected');
    
    const poi = pois.find(p => p.id === poiId);
    if (poi) {
      // Add the POI type to the set of selected types
      selectedTypes.add(poi.type);
      
      // Get the color for this POI type
      const poiColor = getPoiColor(poi.type);
      
      // Convert hex color to rgba for the glow and fill
      const colorValues = hexToRgb(poiColor);
      if (colorValues) {
        // Set the glow color (more opaque)
        marker.css('--poi-glow-color', `rgba(${colorValues.r}, ${colorValues.g}, ${colorValues.b}, 0.8)`);
        // Set the stroke color (solid)
        marker.css('--poi-stroke-color', poiColor);
        // Set the fill color (semi-transparent)
        marker.css('--poi-fill-color', `rgba(${colorValues.r}, ${colorValues.g}, ${colorValues.b}, 0.2)`);
      }
    }
  });
  
  // Highlight the group headers for the selected POI types
  selectedTypes.forEach(type => {
    // Find the group checkbox with the matching data-type
    const checkbox = $(`.group-checkbox[data-type="${type}"]`);
    // Highlight its parent group header
    checkbox.closest('.poi-group-header').addClass('highlighted');
  });
  
  // Update selection indicator in sidebar
  updateSelectionIndicator();
  
  // Update URL with selected POIs
  updateUrlWithSelection();
}

// Function to update the selection indicator in the sidebar
function updateSelectionIndicator() {
  const count = selectedPois.length;
  if (count > 1) {
    $('#selection-count').text(`${count} POIs selected`);
    $('#selection-indicator').show();
  } else {
    $('#selection-indicator').hide();
  }
}

// Helper function to convert hex color to RGB components
function hexToRgb(hex) {
  // Remove # if present
  hex = hex.replace(/^#/, '');
  
  // Parse hex values
  let bigint = parseInt(hex, 16);
  
  // Handle different hex formats (3 or 6 digits)
  if (hex.length === 3) {
    // For 3-digit hex, duplicate each digit
    const r = ((bigint >> 8) & 15) * 17;
    const g = ((bigint >> 4) & 15) * 17;
    const b = (bigint & 15) * 17;
    return { r, g, b };
  } else if (hex.length === 6) {
    // For 6-digit hex
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return { r, g, b };
  }
  
  return null;
}

function deletePoi(poiId) {
  try {
    const poi = pois.find(p => p.id === poiId);
    if (!poi) return;

    // Check if user has permission to delete this POI
    const canDelete = canEditPoi(poiId);
    if (!canDelete) {
      showNotification('You do not have permission to delete this POI', true);
      return;
    }

    // Confirm deletion
    if (!confirm(`Are you sure you want to delete this POI?\n\nType: ${poi.type}\nCoordinates: X: ${poi.x}, Y: ${poi.y}`)) {
      return;
    }

    // Create a copy of the POI with delete action
    const deletedPoi = { 
      ...poi, 
      action: 'delete',
      sessionId: sessionId
    };

    // Add admin token if user has admin permissions
    if (hasEditPermission()) {
      deletedPoi.token = localStorage.getItem('admin_token');
    }

    // Show loading notification
    showNotification('Deleting POI...');

    // Send delete request to server
    fetch(`${API_ENDPOINT}/delete-poi`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(hasEditPermission() && { 'Authorization': `Bearer ${localStorage.getItem('admin_token')}` })
      },
      body: JSON.stringify(deletedPoi),
    })
    .then(response => {
      if (!response.ok) {
        throw new Error(`Server returned ${response.status}: ${response.statusText}`);
      }
      return response.json();
    })
    .then(data => {
      if (data.success) {
        // Remove POI from local array
        pois = pois.filter(p => p.id !== poiId);
        
        // Clear selection if this was the selected POI
        if (selectedPoi === poiId) {
          selectedPoi = null;
        }
        
        // Remove from selectedPois array if present
        selectedPois = selectedPois.filter(id => id !== poiId);
        updateSelectionIndicator();
        
        showNotification('POI deleted successfully');
        renderPois();
        savePoisToStorage();
      } else {
        showNotification('Error deleting POI: ' + (data.error || 'Unknown error'), true);
      }
    })
    .catch(error => {
      console.error('Error deleting POI:', error);
      showNotification('Error deleting POI: ' + error.message, true);
      
      // Fallback: Delete locally if server request fails
      pois = pois.filter(p => p.id !== poiId);
      
      // Clear selection if this was the selected POI
      if (selectedPoi === poiId) {
        selectedPoi = null;
      }
      
      // Remove from selectedPois array if present
      selectedPois = selectedPois.filter(id => id !== poiId);
      updateSelectionIndicator();
      
      showNotification('POI deleted locally (server update failed)');
      renderPois();
      savePoisToStorage();
    });
    trackEvent('DeletePOI', {
      poiId: poiId
    });
  } catch (error) {
    trackError(error, { action: 'DeletePOI', poiId });
    throw error;
  }
}

// Function to approve a POI
function approvePoi(poiId) {
  try {
    const poi = pois.find(p => p.id === poiId);
    if (!poi) return;

    // Only users with admin token can approve POIs
    if (!hasEditPermission()) {
      showNotification('You do not have permission to approve POIs', true);
      return;
    }

    // Check if this POI is already approved
    if (poi.approved === true) {
      showNotification('This POI is already approved', true);
      return;
    }

    // Confirm approval
    if (!confirm(`Are you sure you want to approve this POI?\n\nType: ${poi.type}\nCoordinates: X: ${poi.x}, Y: ${poi.y}`)) {
      return;
    }

    // Check if we're currently showing only unapproved POIs
    const showingOnlyUnapproved = pois.some(p => p.approved && !p.visible);

    // Create a copy of the POI with approved status
    const approvedPoi = { 
      ...poi, 
      approved: true,
      token: localStorage.getItem('admin_token') // Include the admin token
    };

    // Show loading notification
    showNotification('Approving POI...');

    // Send approval request to server with token in the header
    fetch(`${API_ENDPOINT}/approve-poi`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('admin_token')}`
      },
      body: JSON.stringify(approvedPoi),
    })
    .then(response => {
      if (!response.ok) {
        throw new Error(`Server returned ${response.status}: ${response.statusText}`);
      }
      return response.json();
    })
    .then(data => {
      if (data.success) {
        // Always update the local POI first
        const index = pois.findIndex(p => p.id === poiId);
        if (index !== -1) {
          pois[index] = { ...pois[index], approved: true };
        }
        
        // Then update with server data if available
        if (data.approvedPois && data.approvedPois.length > 0) {
          pois = pois.filter(p => p.id !== poiId);
          pois = [...pois, ...data.approvedPois];
        }
        
        // If we were showing only unapproved POIs, maintain that filter
        if (showingOnlyUnapproved) {
          pois.forEach(p => {
            if (p.approved) p.visible = false;
          });
        }
        
        // Update UI
        renderPois();
        savePoisToStorage();
        
        showNotification('POI approved successfully');
      } else {
        showNotification('Error approving POI: ' + (data.error || 'Unknown error'), true);
      }
    })
    .catch(error => {
      console.error('Error approving POI:', error);
      showNotification('Error approving POI: ' + error.message, true);
      
      // Fallback: Update locally if server request fails
      const index = pois.findIndex(p => p.id === poiId);
      if (index !== -1) {
        pois[index] = { ...pois[index], approved: true };
        showNotification('POI approved locally (server update failed)');
        renderPois();
      }
    });
    trackEvent('ApprovePOI', {
      poiId: poiId
    });
  } catch (error) {
    trackError(error, { action: 'ApprovePOI', poiId });
    throw error;
  }
}


// Context menu functions and saving/editing POIs
function showContextMenu(screenX, screenY, mapX, mapY) {
  // Create context menu if it doesn't exist
  if ($('#context-menu').length === 0) {
    $('body').append('<div id="context-menu"></div>');
  }
  
  // Update context menu HTML
  $('#context-menu').html(`
    <div class="context-menu-form">
      <div class="context-menu-field">
        <label for="context-poi-type">Type:</label>
        <select id="context-poi-type">
          <option value="shelter">Rebirth Shelter</option>
          <option value="bunker">Rebirth Bunker</option>
          <option value="container">Locked Containers</option>
          <option value="secret">Secret</option>          
          <option value="fragment">Clearance Fragment</option>
          <option value="machinery">EC Kits/Machinery Parts</option>
          <option value="machinery" style="display: none;">Machinery Parts</option>
          <option value="electronics">Electronics</option>
          <option value="jewelries">Jewelries</option>
          <option value="loot">Loot</option>          
          <option value="distilleries">Botkin Distilleries</option>
          <option value="emp-jammer">EMP Jammer</option>          
          <option value="ec-kits" style="display: none;">EC Kits</option>
          <option value="collectibles">Collectibles</option>
          <option value="respawn">Respawn</option>
        </select>
      </div>
      <div class="context-menu-field">
        <label for="context-poi-note">Note:</label>
        <textarea id="context-poi-note" placeholder="Add a note about this POI (shown on hover)"></textarea>
      </div>
      <!-- <div id="context-nearby-warning" class="warning-message" style="display: none;"></div> -->
      <div class="context-menu-buttons">
        <button id="context-save-btn">Save</button>
        <button id="context-cancel-btn">Cancel</button>
      </div>
    </div>
  `);
  
  // Position context menu
  $('#context-menu').css({
    display: 'block',
    left: screenX + 'px',
    top: screenY + 'px'
  });
  
  // Set coordinates in the form
  $('#context-coordinates').text(`X: ${formatCoordinate(mapX)}, Y: ${formatCoordinate(mapY)}`);
  
  // Check for nearby POIs when type changes
  $('#context-poi-type').on('change', function() {
    checkNearbyPoisFromContext(mapX, mapY, $(this).val());
  });
  
  // Initial check for nearby POIs
  checkNearbyPoisFromContext(mapX, mapY, $('#context-poi-type').val());
  
  // Save button click handler
  $('#context-save-btn').on('click', saveContextMenuPoi);
  
  // Cancel button click handler
  $('#context-cancel-btn').on('click', function() {
    $('#context-menu').hide();
  });
  
  // Store map coordinates in the context menu data
  $('#context-menu').data('mapX', mapX);
  $('#context-menu').data('mapY', mapY);
}

function showEditContextMenu(poiId, screenX, screenY) {
  const poi = pois.find(p => p.id === poiId);
  if (!poi) return;

  // Select the POI
  selectedPoi = poiId;

  const contextMenu = $('#context-menu');
  updateContextMenuHtml();

  // Get dimensions
  const menuWidth = contextMenu.outerWidth();
  const menuHeight = contextMenu.outerHeight();
  const windowWidth = $(window).width();
  const windowHeight = $(window).height();

  // Calculate position to keep menu within viewport
  let posX = screenX;
  let posY = screenY;

  // Adjust X position if menu would go off screen
  if (screenX + menuWidth > windowWidth) {
    posX = windowWidth - menuWidth - 10;
  }
  if (screenX < 0) {
    posX = 10;
  }

  // Adjust Y position if menu would go off screen
  if (screenY + menuHeight > windowHeight) {
    posY = windowHeight - menuHeight - 10;
  }
  if (screenY < 0) {
    posY = 10;
  }

  // Position and show the context menu
  contextMenu.css({
    left: posX + 'px',
    top: posY + 'px',
    display: 'block'
  });

  // Set the POI data in the context menu
  $('#context-poi-type').val(poi.type);
  $('#context-poi-note').val(poi.description || '');
  $('#context-coordinates').text(`X: ${poi.x}, Y: ${poi.y}`);
  
  // Set the color of the dropdown based on POI type
  $('#context-poi-type').css('color', getPoiColor(poi.type));
}

// Update context menu POI saving logic
function saveContextMenuPoi() {
  const contextMenu = $('#context-menu');
  const mapX = contextMenu.data('mapX');
  const mapY = contextMenu.data('mapY');

  const name = `POI-${Date.now().toString().slice(-4)}`;
  const type = $('#context-poi-type').val();
  const description = $('#context-poi-note').val().trim();

  // Check for nearby POIs one last time
  const nearbyPois = checkForNearbyPois(mapX, mapY, type);
  if (nearbyPois.length > 0) {
    // Show custom confirmation modal
    showDuplicateConfirmModalForContext(nearbyPois, mapX, mapY, type, function(confirmed) {
      if (confirmed) {
        // User confirmed, proceed with saving
        createAndSaveContextPoi(type, mapX, mapY, description, name);
      }
      // If not confirmed, do nothing
    });
  } else {
    // No nearby POIs, proceed with saving
    createAndSaveContextPoi(type, mapX, mapY, description, name);
  }
}

// Helper function to create and save a POI from context menu
function createAndSaveContextPoi(type, mapX, mapY, description, name) {
  const poi = {
    id: 'poi-' + Date.now(),
    name: name,
    type: type,
    description: description,
    x: mapX,
    y: mapY,
    visible: true,
    approved: false, // Mark new POIs as unapproved
    dateAdded: new Date().toISOString(),
    sessionId: sessionId // Add session ID to track who created this POI
  };

  // Add to local array temporarily
  pois.push(poi);
  renderPois();
  
  // Send unapproved POI to server
  saveUnapprovedPoi(poi, true);
  
  $('#context-menu').hide();
  
  // Select the new POI after adding it
  selectPoi(poi.id);
}

// Function to save unapproved POIs to the server
function saveUnapprovedPoi(poi, fromContextMenu = false) {
  // Show loading notification
  showNotification('Saving POI...');

  // Send POI to server
  fetch(`${API_ENDPOINT}/save-poi`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(poi),
  })
  .then(response => {
    if (!response.ok) {
      throw new Error(`Server returned ${response.status}: ${response.statusText}`);
    }
    return response.json();
  })
  .then(data => {
    if (data.success) {
      // Add the new POI to the local array if not already added
      if (!pois.some(p => p.id === poi.id)) {
        pois.push(poi);
      }
      
      // Update UI
      renderPois();
      savePoisToStorage();
      
      // Show success notification
      showNotification('POI saved successfully');
      
      // Only clear form and exit add mode if not from context menu
      if (!fromContextMenu) {
        // Clear form
        $('#poi-type').val('shelter');
        $('#poi-x').val('');
        $('#poi-y').val('');
        $('#poi-desc').val('');
        
        // Exit add mode
        toggleAddMode();
      }
    } else {
      showNotification('Error saving POI: ' + (data.error || 'Unknown error'), true);
    }
  })
  .catch(error => {
    console.error('Error saving POI:', error);
    showNotification('Error saving POI: ' + error.message, true);
    
    // Fallback: Save locally if server request fails
    if (!pois.some(p => p.id === poi.id)) {
      pois.push(poi);
    }
    renderPois();
    savePoisToStorage();
    showNotification('POI saved locally (server update failed)');
    
    // Only clear form and exit add mode if not from context menu
    if (!fromContextMenu) {
      // Clear form
      $('#poi-type').val('shelter');
      $('#poi-x').val('');
      $('#poi-y').val('');
      $('#poi-desc').val('');
      
      // Exit add mode
      toggleAddMode();
    }
  });
}

function saveEditedPoi() {
  try {
    const poiId = selectedPoi;
    if (!poiId) return;

    const poi = pois.find(p => p.id === poiId);
    if (!poi) return;

    // Check if user has permission to edit this POI
    const canEdit = canEditPoi(poiId);
    if (!canEdit) {
      showNotification('You do not have permission to edit this POI', true);
      return;
    }

    // Get values from context menu form
    const type = $('#context-poi-type').val();
    const description = $('#context-poi-note').val();

    // Create updated POI object
    const updatedPoi = {
      ...poi,
      type,
      description,
      sessionId: sessionId
    };

    // Add admin token if user has admin permissions
    if (hasEditPermission()) {
      updatedPoi.token = localStorage.getItem('admin_token');
    }

    // Show loading notification
    showNotification('Updating POI...');

    // Send update to server
    fetch(`${API_ENDPOINT}/save-poi`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(hasEditPermission() && { 'Authorization': `Bearer ${localStorage.getItem('admin_token')}` })
      },
      body: JSON.stringify(updatedPoi),
    })
    .then(response => {
      if (!response.ok) {
        throw new Error(`Server returned ${response.status}: ${response.statusText}`);
      }
      return response.json();
    })
    .then(data => {
      if (data.success) {
        // Update local POI
        const index = pois.findIndex(p => p.id === poiId);
        if (index !== -1) {
          pois[index] = {
            ...pois[index],
            type,
            description
          };
        }
        
        // Hide context menu
        $('#context-menu').hide();
        
        // Update UI
        renderPois();
        savePoisToStorage();
        
        showNotification('POI updated successfully');
      } else {
        showNotification('Error updating POI: ' + (data.error || 'Unknown error'), true);
      }
    })
    .catch(error => {
      console.error('Error updating POI:', error);
      showNotification('Error updating POI: ' + error.message, true);
    });
    trackEvent('EditPOI', {
      poiId: poiId
    });
  } catch (error) {
    trackError(error, { action: 'EditPOI', poiId: selectedPoi });
    throw error;
  }
}

// Function to find overlapping POIs at a specific location
function findOverlappingPois(x, y, threshold = 10) {
  // Convert coordinates to screen coordinates
  const screenX = (x / 1.664) + offsetX;
  const screenY = (y / 1.664) + offsetY + MAP_HEIGHT;
  
  // Find all POIs that are within the threshold distance
  return pois.filter(p => p.visible && 
    Math.abs((p.x / 1.664) + offsetX - screenX) < threshold && 
    Math.abs((p.y / 1.664) + offsetY + MAP_HEIGHT - screenY) < threshold);
}

// Rendering functions
function renderPois() {
  $('.poi-marker').remove();
  $('.poi-tooltip').remove();

  const tooltip = $(`<div class="poi-tooltip"></div>`);
  $('body').append(tooltip);

  // Sort POIs to ensure selected POI is rendered on top
  const sortedPois = [...pois].sort((a, b) => {
    // Selected POI should be last (rendered on top)
    if (a.id === selectedPoi) return 1;
    if (b.id === selectedPoi) return -1;
    return 0;
  });

  sortedPois.filter(p => p.visible).forEach(poi => {
      const poiColor = getPoiColor(poi.type);
      
      // Calculate adjusted coordinates for each POI
      //const realX = 585
      //const realY = 1180;

      const realX = (poi.x / 1.664) + offsetX;
      const realY = (poi.y / 1.664) + offsetY + MAP_HEIGHT;

      // Check if this POI was created in the current session
      const isCurrentSession = poi.sessionId === sessionId;
      
      // Create POI marker with approval status indicator
      let svgPath = '';
      if (poi.type === 'respawn') {
        // Star icon for Respawn POIs
        svgPath = `<path fill="transparent" 
                      stroke="${poiColor}" 
                      stroke-width="1.5"
                      d="M12,2.3l2.9,6.9l7.1,0.6l-5.3,4.9l1.6,6.8L12,17.8l-6.3,3.7l1.6-6.8L2,9.8l7.1-0.6L12,2.3z"/>`;
      } else if (poi.type === 'fragment') {
        // Extract first two digits from notes if they exist
        const numberMatch = poi.description ? poi.description.match(/\d{1,3}/) : null;
        const number = numberMatch ? numberMatch[0].padStart(2, '0') : '';
        
        svgPath = `<path fill="transparent" 
                      stroke="${poiColor}" 
                      stroke-width="1.5"
                      d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
                   ${number ? `<text x="12" y="11" 
                      fill="white" 
                      text-anchor="middle" 
                      font-size="7px" 
                      font-weight="bold" 
                      font-family="Arial">${number}</text>` : ''}`;
      } else if (poi.type === 'container') {
        // Location marker with a square inside for Container POIs
        svgPath = `<path fill="transparent" 
                      stroke="${poiColor}" 
                      stroke-width="1.5"
                      d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/>
                   <rect x="9.5" y="7" width="5" height="5" 
                      fill="transparent" 
                      stroke="${poiColor}" 
                      stroke-width="1.5" />`;
      } else {
        // Default location marker for all other POIs
        svgPath = `<path fill="transparent" 
                      stroke="${poiColor}" 
                      stroke-width="1.5"
                      d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>`;
      }
      
      const marker = $(`
          <div class="poi-marker ${poi.approved ? 'approved' : 'unapproved'} ${poi.id === selectedPoi ? 'selected' : ''} ${isCurrentSession ? 'current-session' : ''}" 
               data-id="${poi.id}" 
               style="left: ${realX}px; top: ${realY}px;">
              <svg viewBox="0 0 24 24">
                  ${svgPath}
                  ${isCurrentSession ? '<circle cx="6" cy="6" r="3" fill="#4CAF50" stroke="white" stroke-width="0.5" />' : ''}
              </svg>
          </div>
      `);

      // Show tooltip with approval status
      marker.on('mouseenter', function (e) {
          let shouldShowTooltip = false;
          let tooltipContent = '';
          
          // Determine if and what tooltip content to show
          if (poi.description && poi.description.trim() !== '') {
              // Show description and approval status if needed
              const approvalText = poi.approved ? '' : '<div class="approval-status">[Awaiting Approval]</div>';
              tooltipContent = `<div class="tooltip-description">${poi.description}</div>${approvalText}`;
              shouldShowTooltip = true;
          } else if (!poi.approved) {
              // If no description but awaiting approval, only show approval status
              tooltipContent = '<div class="approval-status">[Awaiting Approval]</div>';
              shouldShowTooltip = true;
          }
          
          if (shouldShowTooltip) {
              // Update tooltip content
              tooltip.html(tooltipContent);
              
              // Calculate position above the marker
              const markerRect = this.getBoundingClientRect();
              const tooltipX = markerRect.left + (markerRect.width / 2);
              const tooltipY = markerRect.top;
              
              // Show tooltip
              tooltip.css({
                  left: tooltipX + 'px',
                  top: tooltipY + 'px',
                  visibility: 'visible',
                  opacity: 1
              });
          } else {
              // Hide tooltip if no content to show
              tooltip.css({
                  visibility: 'hidden',
                  opacity: 0
              });
          }
      });

      marker.on('mouseleave', function () {
          tooltip.css({
              visibility: 'hidden',
              opacity: 0
          });
      });

      // Add click handler for cycling through overlapping POIs
      marker.on('click', function(e) {
          e.stopPropagation(); // Prevent the map click handler from firing
          
          const clickedPoiId = $(this).data('id');
          const clickedPoi = pois.find(p => p.id === clickedPoiId);
          
          if (clickedPoi) {
              // Check if ctrl key is pressed for multi-selection
              if (e.ctrlKey) {
                  selectPoi(clickedPoiId, true);
                  return;
              }
              
              // Find all overlapping POIs
              const overlappingPois = findOverlappingPois(clickedPoi.x, clickedPoi.y);
              
              if (overlappingPois.length > 1) {
                  // If there are overlapping POIs and one is already selected
                  if (selectedPoi) {
                      // Check if we're already cycling through these overlapping POIs
                      const currentIndex = overlappingPois.findIndex(p => p.id === selectedPoi);
                      
                      // If the currently selected POI is not in the overlapping set or we have multiple POIs selected,
                      // then we should reset the selection to just this POI
                      if (currentIndex === -1 || selectedPois.length > 1) {
                          // Reset selection to just this POI
                          selectPoi(clickedPoiId);
                          
                          // Show a notification about multiple POIs
                          showNotification(`${overlappingPois.length} overlapping POIs found. Click again to cycle through them.`, false);
                      } else {
                          // Continue cycling through overlapping POIs
                          const nextIndex = (currentIndex + 1) % overlappingPois.length;
                          selectPoi(overlappingPois[nextIndex].id);
                          
                          // Show a notification about cycling
                          if (overlappingPois.length > 2) {
                              showNotification(`Cycling through ${overlappingPois.length} overlapping POIs (${nextIndex + 1}/${overlappingPois.length})`, false);
                          }
                      }
                  } else {
                      // If no POI is selected, select the clicked one
                      selectPoi(clickedPoiId);
                      
                      // Show a notification about multiple POIs
                      if (overlappingPois.length > 1) {
                          showNotification(`${overlappingPois.length} overlapping POIs found. Click again to cycle through them.`, false);
                      }
                  }
              } else {
                  // If there's only one POI, simply select it
                  selectPoi(clickedPoiId);
              }
          }
      });

      // Add right-click handler for editing POIs
      marker.on('contextmenu', function(e) {
          e.preventDefault();
          e.stopPropagation();
          
          const poiId = $(this).data('id');
          selectPoi(poiId); // Select the POI that was right-clicked
          showEditContextMenu(poiId, e.pageX, e.pageY);
      });

      // Add double-click handler as an alternative way to edit POIs
      marker.on('dblclick', function(e) {
          e.preventDefault();
          e.stopPropagation();
          
          const poiId = $(this).data('id');
          selectPoi(poiId); // Select the POI that was double-clicked
          showEditContextMenu(poiId, e.pageX, e.pageY);
      });

      $('#game-map').append(marker);
  });
}

$('head').append(`
  <style>
      .poi-marker.unapproved {
          opacity: 0.7;
      }
      .poi-marker.unapproved svg {
          filter: saturate(0.7);
      }
      .poi-marker.unapproved svg path {
          stroke-dasharray: 2, 1;
      }
  </style>
`);

function getPoiColor(type) {
  switch (type) {
    case 'shelter':
      return '#ffd700'; // Gold
    case 'bunker':
      return '#b8860b'; // Dark goldenrod
    case 'fragment':
      return '#73a575'; // Green
    case 'machinery':
      return '#d3d3d3'; // Light gray
    case 'electronics':
      return '#2196f3'; // Blue
    case 'secret':
      return '#607d8b'; // Blue gray
    case 'ec-kits':
      return '#d8b4e2'; // Light purple
    case 'collectibles':
      return '#FFB6C1'; // Light pink
    case 'jewelries':
      return '#9370DB'; // Medium Purple
    case 'loot':
      return '#9c27b0'; // Purple
    case 'container':
      return '#9b8840'; // Olive
    case 'respawn':
      return '#ff0000'; // Red
    case 'distilleries':
      return '#00CED1'; // Teal/Turquoise
    case 'emp-jammer':
      return '#e91e63'; // Pink
    default:
      return '#ffffff'; // White for unknown types
  }
}

// Storage and sync functions
function loadPoisFromStorage() {
  const storedPois = localStorage.getItem(STORAGE_KEY);
  if (storedPois) {
    try {
      pois = JSON.parse(storedPois);
      
      // Ensure all POIs have a sessionId (for backward compatibility)
      pois.forEach(poi => {
        if (!poi.sessionId && !poi.approved) {
          poi.sessionId = sessionId;
        }
      });
      
      return true;
    } catch (e) {
      console.error('Error parsing stored POIs:', e);
      return false;
    }
  }
  return false;
}

function savePoisToStorage() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(pois));
}

function syncWithServer(force = false) {
  return new Promise((resolve) => {
    if (force || Date.now() - lastSyncTime > 60000) {
      showNotification('Syncing with server...');

      setTimeout(() => {
        lastSyncTime = Date.now();
        savePoisToStorage();
        showNotification('Sync complete');
        resolve();
      }, 1000);
    } else {
      // If no sync needed, resolve immediately
      resolve();
    }
  });
}

function showNotification(message, isError = false) {
  const notification = $('#notification');
  notification.text(message);
  notification.css('background-color', isError ? 'rgba(255, 0, 0, 0.8)' : 'rgba(0, 0, 0, 0.8)');
  notification.fadeIn(300).delay(2000).fadeOut(300);
}

function toggleGroupVisibility(type, visible) {
  pois.forEach(poi => {
    if (poi.type === type) {
      poi.visible = visible;
    }
  });
  renderPois();
  savePoisToStorage();

  trackEvent('TogglePoiGroup', {
    groupType: type,
    visible: visible
  });
}

// Function to parse URL parameters
function getUrlParameters() {
  const params = {};
  const queryString = window.location.search.substring(1);
  
  if (queryString) {
    const pairs = queryString.split('&');
    pairs.forEach(pair => {
      const [key, value] = pair.split('=');
      if (key && value) {
        // If the parameter already exists, convert it to an array
        if (params[key]) {
          if (!Array.isArray(params[key])) {
            params[key] = [params[key]];
          }
          params[key].push(decodeURIComponent(value));
        } else {
          params[key] = decodeURIComponent(value);
        }
      }
    });
  }
  
  return params;
}

// Function to update POI group visibility based on URL parameters
function updateGroupsFromUrl() {
  const params = getUrlParameters();
  
  if (params.group) {
    // Convert to array if it's a single value
    const groups = Array.isArray(params.group) ? params.group : [params.group];
    
    // First uncheck all groups
    $('.group-checkbox').prop('checked', false);
    
    // Then check only the ones specified in the URL
    groups.forEach(group => {
      $(`.group-checkbox[data-type="${group}"]`).prop('checked', true);
    });
    
    // Trigger change event for all checkboxes to update visibility
    $('.group-checkbox').trigger('change');
    
    // If exactly one group is selected, center the map on the POIs of that group
    if (groups.length === 1) {
      // Wait a short moment for the POIs to be rendered
      setTimeout(() => {
        centerMapOnPoisOfType(groups[0]);
        showNotification(`Centered map on ${groups[0]} POIs`);
      }, 300);
    }
  }
}

// Function to update URL with current group and POI selections
function updateUrlWithGroups() {
  // Create the base URL
  let newUrl = window.location.pathname;
  let params = [];
  
  // Always include group parameters regardless of POI selection
  const selectedGroups = [];
  
  // Get all checked group checkboxes
  $('.group-checkbox:checked').each(function() {
    const groupType = $(this).data('type');
    // Ensure no duplicates
    if (!selectedGroups.includes(groupType)) {
      selectedGroups.push(groupType);
    }
  });
  
  // Add group parameters
  if (selectedGroups.length > 0) {
    selectedGroups.forEach(group => {
      params.push(`group=${encodeURIComponent(group)}`);
    });
  }
  
  // If there are selected POIs, include them in the URL as well
  if (selectedPois.length > 0) {
    params.push(`locations=${selectedPois.join(',')}`);
  }
  
  // Add any other existing parameters except 'group' and 'locations'
  const urlParams = new URLSearchParams(window.location.search);
  for (const [key, value] of urlParams.entries()) {
    if (key !== 'group' && key !== 'locations') {
      params.push(`${key}=${encodeURIComponent(value)}`);
    }
  }
  
  // Append parameters to URL
  if (params.length > 0) {
    newUrl += '?' + params.join('&');
  }
  
  // Update the URL without reloading the page
  window.history.replaceState({}, document.title, newUrl);
}

// Function to update URL with current POI selection
function updateUrlWithSelection() {
  // We'll reuse the updateUrlWithGroups function since it now handles both
  updateUrlWithGroups();
}

// Function to update POI selection based on URL parameters
function updateSelectionFromUrl() {
  const params = getUrlParameters();
  
  if (params.locations) {
    // Get the POI IDs from the URL
    const selectedIds = params.locations.split(',');
    
    // Clear existing selection
    selectedPois = [];
    selectedPoi = null;
    
    // Select each POI (limiting to MAX_SELECTED_POIS)
    const validIds = selectedIds.filter(id => pois.some(p => p.id === id));
    const limitedIds = validIds.slice(0, MAX_SELECTED_POIS);
    
    if (limitedIds.length > 0) {
      // Use last one as the primary selection
      selectedPoi = limitedIds[limitedIds.length - 1];
      selectedPois = [...limitedIds];
      
      // Update the visual state of markers
      $('.poi-marker').removeClass('selected multi-selected');
      
      // Remove highlight from all group headers
      $('.poi-group-header').removeClass('highlighted');
      
      // Track unique types of selected POIs
      const selectedTypes = new Set();
      
      selectedPois.forEach(id => {
        const marker = $(`.poi-marker[data-id="${id}"]`);
        marker.addClass(id === selectedPoi ? 'selected' : 'multi-selected');
        
        // Apply styling
        const poi = pois.find(p => p.id === id);
        if (poi) {
          // Add the POI type to the set of selected types
          selectedTypes.add(poi.type);
          
          const poiColor = getPoiColor(poi.type);
          const colorValues = hexToRgb(poiColor);
          if (colorValues) {
            marker.css('--poi-glow-color', `rgba(${colorValues.r}, ${colorValues.g}, ${colorValues.b}, 0.8)`);
            marker.css('--poi-stroke-color', poiColor);
            marker.css('--poi-fill-color', `rgba(${colorValues.r}, ${colorValues.g}, ${colorValues.b}, 0.2)`);
          }
        }
      });
      
      // Highlight the group headers for the selected POI types
      selectedTypes.forEach(type => {
        // Find the group checkbox with the matching data-type
        const checkbox = $(`.group-checkbox[data-type="${type}"]`);
        // Highlight its parent group header
        checkbox.closest('.poi-group-header').addClass('highlighted');
      });
      
      // Update the selection indicator
      updateSelectionIndicator();
    }
  }
}

// Function to process URLs and identify loaded POIs from the locations parameter
function processUrlSelectedPois() {
  // Check if we've already processed the URL
  if (window.urlPoisProcessed) {
    return;
  }
  
  const params = getUrlParameters();
  
  if (!params.locations) {
    window.urlPoisProcessed = true;
    return; // No POIs to process in URL
  }
  
  // Get the POI IDs from the URL
  const selectedIds = params.locations.split(',');
  
  // Check if all selected POIs exist in the loaded POIs
  const validIds = selectedIds.filter(id => pois.some(p => p.id === id));
  
  // If some POIs are missing, show a notification
  if (validIds.length < selectedIds.length) {
    const missingCount = selectedIds.length - validIds.length;
    showNotification(`${missingCount} selected POI(s) could not be found`, true);
    
    // Update the URL to only include valid POIs
    if (validIds.length > 0) {
      // Create a new URL with only valid POIs
      let newUrl = window.location.pathname;
      let params = [];
      
      params.push(`locations=${validIds.join(',')}`);
      
      // Add any other existing parameters except 'group' and 'select'
      const urlParams = new URLSearchParams(window.location.search);
      for (const [key, value] of urlParams.entries()) {
        if (key !== 'group' && key !== 'select' && key !== 'locations') {
          params.push(`${key}=${encodeURIComponent(value)}`);
        }
      }
      
      // Append parameters to URL
      if (params.length > 0) {
        newUrl += '?' + params.join('&');
      }
      
      // Update the URL without reloading the page
      window.history.replaceState({}, document.title, newUrl);
    } else {
      // If no valid POIs, remove the locations parameter
      let newUrl = window.location.pathname;
      let params = [];
      
      // Add any other existing parameters except 'group', 'select', and 'locations'
      const urlParams = new URLSearchParams(window.location.search);
      for (const [key, value] of urlParams.entries()) {
        if (key !== 'group' && key !== 'select' && key !== 'locations') {
          params.push(`${key}=${encodeURIComponent(value)}`);
        }
      }
      
      // Append parameters to URL
      if (params.length > 0) {
        newUrl += '?' + params.join('&');
      }
      
      // Update the URL without reloading the page
      window.history.replaceState({}, document.title, newUrl);
    }
  } else if (validIds.length > 0) {
    // All POIs found, show a notification
    showNotification(`${validIds.length} POI(s) selected from URL`);
  }
  
  // Apply the selection
  updateSelectionFromUrl();
  
  // Hide all other POIs that aren't in url
  hideNonUrlPois(validIds);
  
  // Center the map on the selected POIs
  centerMapOnSelectedPois();
  
  // Mark as processed
  window.urlPoisProcessed = true;
}

// Function to hide all POIs that aren't in the URL's locations parameter
function hideNonUrlPois(selectedIds) {
  // Always hide other POIs when multiple POIs are selected
  if (selectedIds && selectedIds.length > 1) {
    // Set all POIs to invisible first
    pois.forEach(poi => {
      poi.visible = false;
    });
    
    // Then make only the selected POIs visible
    selectedIds.forEach(id => {
      const poi = pois.find(p => p.id === id);
      if (poi) {
        poi.visible = true;
      }
    });
    
    // Also make any POIs in the selectedPois array visible (for newly added POIs)
    selectedPois.forEach(id => {
      const poi = pois.find(p => p.id === id);
      if (poi) {
        poi.visible = true;
      }
    });
    
    // Re-render POIs with new visibility settings
    renderPois();
    showNotification(`Showing only ${selectedIds.length} selected POI(s)`);
    
    // Update the group checkboxes to reflect the current visibility
    $('.group-checkbox').each(function() {
      const type = $(this).data('type');
      const hasVisiblePois = pois.some(p => p.type === type && p.visible);
      $(this).prop('checked', hasVisiblePois);
    });
  }
}

// Note: We always hide other POIs when multiple POIs are selected, so no need for a restore function

$(document).ready(function () {
  // Check if this is the user's first visit or if they haven't chosen to hide the welcome message
  function checkFirstVisit() {
    // Only hide the welcome message if the user has explicitly chosen to never show it again
    if (localStorage.getItem('exoborne_never_show_welcome') === 'true') {
      // User has chosen to never show the welcome message again
      return;
    }
    
    // Show welcome placeholder
    $('#welcome-placeholder').css('display', 'flex');
    
    // Add event listener for the "Got it" button
    $('#welcome-got-it-btn').on('click', function() {
      // Check if "Never show again" is checked
      if ($('#never-show-welcome').is(':checked')) {
        // Set the flag in localStorage to remember that the user doesn't want to see the welcome message again
        localStorage.setItem('exoborne_never_show_welcome', 'true');
      }
      
      // Hide the welcome placeholder
      $('#welcome-placeholder').fadeOut(500);
    });
  }
  
  // Call the function to check if it's the first visit
  checkFirstVisit();

  // Add event listener for Other Loot link
  $('#other-loot-link').on('click', function(e) {
    e.preventDefault();
    // Show the Other Loot modal
    $('#other-loot-modal').css('display', 'block');
    
    // Update URL with loot parameter
    updateUrlWithLootParam(true);
    
    // Track event if analytics is available
    if (typeof trackEvent === 'function') {
      trackEvent('other_loot_opened');
    }
  });
  
  // Add event listener for the close button in the Other Loot modal
  $('#close-loot-modal').on('click', function() {
    closeOtherLootModal();
  });
  
  // Close modal when clicking outside the content
  $('#other-loot-modal').on('click', function(event) {
    if (event.target === this) {
      closeOtherLootModal();
    }
  });
  
  // Add keyboard support to close the modal with Escape key
  $(document).on('keydown', function(event) {
    if (event.key === 'Escape' && $('#other-loot-modal').css('display') === 'block') {
      closeOtherLootModal();
    }
  });

  // Mobile placeholder "Continue Anyway" button
  $('#continue-anyway-btn').on('click', function() {
    $('#mobile-placeholder').hide();
    $('body > *:not(#mobile-placeholder)').css('display', '');
    
    // Force layout recalculation
    setTimeout(function() {
      // Adjust map size for mobile
      const containerWidth = $('#map-container').width();
      const containerHeight = $('#map-container').height();
      
      // Reset view to ensure map is visible
      resetMapView();
      
      // Show notification about limited functionality
      showNotification('Mobile experience may have limited functionality', false, 5000);
    }, 100);
  });

  // Initialize the map
  initMap();
  
  // Initialize session ID
  initSessionId();
  
  // Load POIs from storage first (faster)
  if (!loadPoisFromStorage()) {
    // If loading from storage fails, load from file
    loadPoisFromFile();
  } else {
    // If loading from storage succeeds, still sync with server
    renderPois();
    syncWithServer();
  }
  
  // Check for URL parameters
  checkUrlParameters();
  
  // Preload overlay images
  preloadOverlayImages();
  
  // Add event handlers for coordinate inputs to check for nearby POIs
  $('#poi-x, #poi-y').on('input', checkNearbyPoisFromForm);
  $('#poi-type').on('change', checkNearbyPoisFromForm);
  
  // Add event handlers for map interactions
  // ... rest of the existing code

  // Update groups from URL parameters
  updateGroupsFromUrl();
  
  // Add window resize handler to adjust zoom level
  let resizeTimer;
  $(window).on('resize', function() {
    // Use a debounce to avoid excessive calculations during resize
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function() {
      const containerWidth = $('#map-container').width();
      const containerHeight = $('#map-container').height();
      
      // Calculate minimum zoom level based on container dimensions
      const minZoomWidth = containerWidth / MAP_WIDTH;
      const minZoomHeight = containerHeight / MAP_HEIGHT;
      const minZoom = Math.max(0.2, Math.min(minZoomWidth, minZoomHeight));
      
      // If current zoom is less than minimum, adjust it
      if (currentZoom < minZoom) {
        currentZoom = minZoom;
        
        // Apply boundary constraints to ensure the map stays within the viewport
        applyMapBoundaryConstraints(containerWidth, containerHeight);
        
        updateMapTransform();
        updateZoomIndicator();
      }
    }, 250); // Wait for 250ms after resize ends
  });
  
  // Add event listeners for map interactions
  // $('#add-mode-btn').on('click', toggleAddMode); // Already bound in initMap

  // Apply group visibility from URL parameters
  updateGroupsFromUrl();

  // Show unapproved button if user has edit permissions
  if (hasEditPermission()) {
    $('#show-unapproved-btn').show();
  }

  // Initialize the color of the POI type dropdown in the sidebar
  $('#poi-type').on('change', function() {
    const selectedType = $(this).val();
    $(this).css('color', getPoiColor(selectedType));
  });
  
  // Set initial color for the dropdown
  $('#poi-type').css('color', getPoiColor($('#poi-type').val()));

  // Add this new event listener for ESC key
  $(document).on('keydown', function(e) {
    if (e.key === 'Escape') {
      $('#context-menu').hide();
    }
  });

  // Add event listener for right-click (context menu)
  $('#game-map').on('contextmenu', function (e) {
    e.preventDefault();
    handleMapClick(e);
  });

  // Add event listener for double left-click
  $('#game-map').on('dblclick', function (e) {
    e.preventDefault();
    handleMapClick(e);
  });

  // Add event listener for regular click to deselect pins
  $('#game-map').on('click', function (e) {
    // If we're in add mode, let the add mode handler take care of it
    if (addMode) {
      return;
    }
    
    // Only proceed if we didn't click on a POI marker
    if ($(e.target).closest('.poi-marker').length === 0) {
      // Deselect any selected POI
      if (selectedPoi) {
        selectedPoi = null;
        $('.poi-marker').removeClass('selected multi-selected');
        // Clear group highlighting
        $('.poi-group-header').removeClass('highlighted');
        updateSelectionIndicator();
        updateUrlWithSelection();
      }
    }
  });
  
  // Add event listener for clicks on the map container (but outside the game-map)
  $('#map-container').on('click', function (e) {
    // Only handle clicks directly on the map container (not on its children)
    // Also ignore clicks on map controls
    if (e.target === this && !$(e.target).closest('.map-controls').length) {
      // Check if we clicked on the coordinates display
      if (!$(e.target).closest('#coordinates-display').length) {
        // Deselect any selected POI
        if (selectedPoi) {
          selectedPoi = null;
          $('.poi-marker').removeClass('selected multi-selected');
          // Clear group highlighting
          $('.poi-group-header').removeClass('highlighted');
          updateSelectionIndicator();
          updateUrlWithSelection();
        }
      }
    }
  });

  $('#context-menu').on('click', function (e) {
    e.stopPropagation();
  });

  $(document).on('click', function (e) {
    if ($(e.target).closest('#context-menu').length === 0) {
      $('#context-menu').hide();
    }
  });

  $('#context-poi-type').on('change', function () {
    const selectedType = $(this).val();
    $(this).css('color', getPoiColor(selectedType));
  });

  $('#poi-type').on('change', function () {
    const selectedType = $(this).val();
    $(this).css('color', getPoiColor(selectedType));
  });

  $('#poi-type').css('color', getPoiColor($('#poi-type').val()));

  $('#map-container').on('wheel', function (e) {
    e.preventDefault();
    
    // Calculate zoom delta based on wheel direction and current zoom level
    // This makes zooming more responsive at different zoom levels
    const zoomFactor = 0.15; // Base zoom factor
    const direction = e.originalEvent.deltaY > 0 ? -1 : 1;
    
    // Scale the zoom factor based on current zoom level
    // This makes zooming more precise at higher zoom levels
    const scaledDelta = direction * zoomFactor * (currentZoom < 1 ? 0.5 : 1);
    
    // Get cursor position relative to the map container
    const cursorX = e.pageX - $(this).offset().left;
    const cursorY = e.pageY - $(this).offset().top;
    
    // Pass cursor position to changeZoom for zooming towards cursor
    changeZoom(scaledDelta, cursorX, cursorY);
  });

  $('.group-checkbox').on('change', function (e) {
    const type = $(this).data('type');
    const checked = $(this).prop('checked');
    
    // Update POI visibility
    pois.forEach(poi => {
      if (poi.type === type) {
        poi.visible = checked;
      }
    });
    
    renderPois();
    savePoisToStorage();
    
    // Update URL with current group selections
    let newUrl = window.location.pathname;
    let groupParams = [];
    
    // Get all checked group checkboxes
    $('.group-checkbox:checked').each(function() {
      const groupType = $(this).data('type');
      // Ensure no duplicates
      if (!groupParams.includes(`group=${encodeURIComponent(groupType)}`)) {
        groupParams.push(`group=${encodeURIComponent(groupType)}`);
      }
    });
    
    // If there are group parameters, add them to the URL
    if (groupParams.length > 0) {
      newUrl += '?' + groupParams.join('&');
      
      // Add any other existing parameters except 'group' and 'locations'
      const urlParams = new URLSearchParams(window.location.search);
      let otherParams = [];
      for (const [key, value] of urlParams.entries()) {
        if (key !== 'group' && key !== 'locations') {
          otherParams.push(`${key}=${encodeURIComponent(value)}`);
        }
      }
      
      // Append other parameters to URL
      if (otherParams.length > 0) {
        newUrl += '&' + otherParams.join('&');
      }
    } else {
      // If no groups are selected, just include other parameters
      const urlParams = new URLSearchParams(window.location.search);
      let otherParams = [];
      for (const [key, value] of urlParams.entries()) {
        if (key !== 'group' && key !== 'locations') {
          otherParams.push(`${key}=${encodeURIComponent(value)}`);
        }
      }
      
      // Append other parameters to URL
      if (otherParams.length > 0) {
        newUrl += '?' + otherParams.join('&');
      }
    }
    
    // Update the URL without reloading the page
    window.history.replaceState({}, document.title, newUrl);
    
    trackEvent('TogglePoiGroup', {
      groupType: type,
      visible: checked
    });
  });

  // Handle Select All button
  $('#select-all-btn').on('click', function() {
    // Check all group checkboxes (this will trigger the change event)
    $('.group-checkbox').prop('checked', true).trigger('change');
    
    // Clear any selected POIs
    selectedPoi = null;
    selectedPois = [];
    $('.poi-marker').removeClass('selected multi-selected');
    // Clear group highlighting
    $('.poi-group-header').removeClass('highlighted');
    updateSelectionIndicator();
    
    showNotification('All groups selected');
  });

  // Handle Select None button
  $('#select-none-btn').on('click', function() {
    // Uncheck all group checkboxes (this will trigger the change event)
    $('.group-checkbox').prop('checked', false).trigger('change');
    
    // Explicitly clear all group parameters from the URL
    clearUrlParameters();
    
    // Clear any selected POIs
    selectedPoi = null;
    selectedPois = [];
    $('.poi-marker').removeClass('selected multi-selected');
    // Clear group highlighting
    $('.poi-group-header').removeClass('highlighted');
    updateSelectionIndicator();
    
    showNotification('All groups deselected');
  });

  // Handle category "Only" buttons (Money Making, Resources)
  $('.poi-category h4 .select-all-btn').on('click', function(e) {
    e.stopPropagation();
    
    // Get the parent category element
    const category = $(this).closest('.poi-category');
    
    // Uncheck all checkboxes first
    $('.group-checkbox').prop('checked', false);
    
    // Check only the checkboxes within this category
    category.find('.group-checkbox').prop('checked', true);
    
    // Update POI visibility based on the checked checkboxes
    const selectedTypes = [];
    category.find('.group-checkbox').each(function() {
      const type = $(this).data('type');
      selectedTypes.push(type);
    });
    
    pois.forEach(poi => {
      poi.visible = selectedTypes.includes(poi.type);
    });
    
    renderPois();
    savePoisToStorage();
    
    // Update URL to include all groups in this category
    let newUrl = window.location.pathname;
    let groupParams = [];
    
    selectedTypes.forEach(type => {
      groupParams.push(`group=${encodeURIComponent(type)}`);
    });
    
    if (groupParams.length > 0) {
      newUrl += '?' + groupParams.join('&');
      
      // Add any other existing parameters except 'group' and 'locations'
      const urlParams = new URLSearchParams(window.location.search);
      let otherParams = [];
      for (const [key, value] of urlParams.entries()) {
        if (key !== 'group' && key !== 'locations') {
          otherParams.push(`${key}=${encodeURIComponent(value)}`);
        }
      }
      
      // Append other parameters to URL
      if (otherParams.length > 0) {
        newUrl += '&' + otherParams.join('&');
      }
    }
    
    // Update the URL without reloading the page
    window.history.replaceState({}, document.title, newUrl);
    
    // Clear any selected POIs
    selectedPoi = null;
    selectedPois = [];
    $('.poi-marker').removeClass('selected multi-selected');
    // Clear group highlighting
    $('.poi-group-header').removeClass('highlighted');
    updateSelectionIndicator();
    
    // Get category name for notification
    const categoryName = category.find('h4').text().split(' ')[0];
    
    // Get all visible POIs after the category selection
    const visiblePois = pois.filter(poi => poi.visible);
    
    // Center the map on these POIs if there are any
    if (visiblePois.length > 0) {
      // Create temporary selectedPois array for centering
      const tempSelectedPois = visiblePois.map(poi => poi.id);
      
      // Store original selectedPois
      const originalSelectedPois = selectedPois;
      
      // Temporarily set selectedPois to the filtered POIs
      selectedPois = tempSelectedPois;
      
      // Center the map on the filtered POIs
      centerMapOnSelectedPois();
      
      // Restore original selectedPois
      selectedPois = originalSelectedPois;
    }
    
    showNotification(`Showing only ${categoryName} POIs`);
  });

  // Handle Select Only buttons
  $('.select-only-btn').on('click', function(e) {
    e.stopPropagation(); // Prevent triggering the checkbox click
    const selectedType = $(this).data('type');
    
    // Uncheck all checkboxes
    $('.group-checkbox').prop('checked', false).trigger('change');
    
    // Check only the selected one
    $(`.group-checkbox[data-type="${selectedType}"]`).prop('checked', true).trigger('change');
    
    // Update POI visibility
    pois.forEach(poi => {
      poi.visible = (poi.type === selectedType);
    });
    
    renderPois();
    savePoisToStorage();
    
    // Update URL to include only this group
    let newUrl = window.location.pathname + `?group=${encodeURIComponent(selectedType)}`;
    
    // Add any other existing parameters except 'group' and 'locations'
    const urlParams = new URLSearchParams(window.location.search);
    let otherParams = [];
    for (const [key, value] of urlParams.entries()) {
      if (key !== 'group' && key !== 'locations') {
        otherParams.push(`${key}=${encodeURIComponent(value)}`);
      }
    }
    
    // Append other parameters to URL
    if (otherParams.length > 0) {
      newUrl += '&' + otherParams.join('&');
    }
    
    // Update the URL without reloading the page
    window.history.replaceState({}, document.title, newUrl);
    
    // Clear any selected POIs
    selectedPoi = null;
    selectedPois = [];
    $('.poi-marker').removeClass('selected multi-selected');
    // Clear group highlighting
    $('.poi-group-header').removeClass('highlighted');
    updateSelectionIndicator();
    
    // Center the map on POIs of the selected type
    centerMapOnPoisOfType(selectedType);
    
    showNotification(`Showing only ${selectedType} POIs`);
  });

  // Show only POIs of a specific type
  // NOTE: This is a duplicate handler and is no longer needed since we've updated the handler above
  $('.select-only-btn').on('click', function () {
    const type = $(this).data('type');
    
    // Uncheck all group checkboxes
    $('.group-checkbox').prop('checked', false);
    
    // Check only the selected type
    $(`#group-${type}`).prop('checked', true);
    
    // Update POI visibility
    pois.forEach(poi => {
      poi.visible = (poi.type === type);
    });
    
    renderPois();
    savePoisToStorage();
    
    // Center the map on POIs of the selected type
    centerMapOnPoisOfType(type);
  });

  // Show only unapproved POIs
  $('#show-unapproved-btn').on('click', function () {
    // Uncheck all group checkboxes
    $('.group-checkbox').prop('checked', false);
    
    // Update POI visibility to show only unapproved POIs
    pois.forEach(poi => {
      poi.visible = !poi.approved;
    });
    
    renderPois();
    savePoisToStorage();
    
    // Center the map on unapproved POIs
    centerMapOnUnapprovedPois();
    
    showNotification('Showing only unapproved POIs');
  });

  $('#map-container').on('mousemove', function (e) {
    const mapOffset = $('#game-map').offset();
    const mapX = Math.round((e.pageX - mapOffset.left) / currentZoom);
    const mapY = Math.round(((e.pageY - mapOffset.top) / currentZoom) - MAP_HEIGHT);
  
    // Apply the offsets
    const adjustedX = (mapX - offsetX) * 1.664;
    const adjustedY = (mapY - offsetY) * 1.664;

    // Determine precision based on zoom level
    // Higher zoom = more decimal places
    const precision = currentZoom > 2 ? 2 : (currentZoom > 1 ? 1 : 0);
    
    // Format coordinates with appropriate precision
    const formattedX = formatCoordinateWithPrecision(adjustedX, precision);
    const formattedY = formatCoordinateWithPrecision(adjustedY, precision);

    // Update the display with the adjusted coordinates
    $('#coordinates-display').text(`X: ${formattedX}, Y: ${formattedY}`);
  });

  $('#game-map').on('mousemove', function (e) {
    $('#map-container').trigger('mousemove');
  });
  // Toggle filter section visibility
  $('#toggle-filter').on('click', function() {
    const $container = $('#poi-groups-container');
    const $filterControls = $('.filter-controls');
    const $button = $(this);
    
    if ($container.is(':visible')) {
      $container.slideUp(200);
      $filterControls.slideUp(200);
      $button.text('▲');
    } else {
      $container.slideDown(200);
      $filterControls.slideDown(200);
      $button.text('▼');
    }
  });

  // Update groups from URL parameters
  updateGroupsFromUrl();
  
  // Load POI selections from URL parameters (after POIs are loaded)
  syncWithServer().then(() => {
    processUrlSelectedPois();
  });
  
  // Handle clear selection button
  $('#clear-selection-btn').on('click', function() {
    selectedPoi = null;
    selectedPois = [];
    $('.poi-marker').removeClass('selected multi-selected');
    // Clear group highlighting
    $('.poi-group-header').removeClass('highlighted');
    updateSelectionIndicator();
    updateUrlWithSelection();
  });
  
  // Handle center selection button
  $('#center-selection-btn').on('click', function() {
    if (selectedPois.length > 0) {
      centerMapOnSelectedPois();
    }
  });
  
  // Note: We always hide other POIs when multiple POIs are selected
  
  // Add keyboard shortcut for clearing selection
  $(document).on('keydown', function(e) {
    if (e.key === 'Escape') {
      $('#context-menu').hide();
      
      // Clear selection when pressing Escape key
      if (selectedPoi || selectedPois.length > 0) {
        selectedPoi = null;
        selectedPois = [];
        $('.poi-marker').removeClass('selected multi-selected');
        // Clear group highlighting
        $('.poi-group-header').removeClass('highlighted');
        updateSelectionIndicator();
        updateUrlWithSelection();
      }
    }
  });

  // Add event listeners for category buttons in the Other Loot modal
  $('.category-btn').on('click', function() {
    const category = $(this).data('category');
    
    // Filter loot items by category
    filterLootByCategory(category);
    
    // Update URL with category parameter
    updateUrlWithLootParam(true, category);
  });

  // Admin login button
  $('#admin-login-btn').on('click', function() {
    // If already logged in, show logout option
    if (hasEditPermission()) {
      if (confirm('You are already logged in as admin. Do you want to log out?')) {
        logoutAdmin();
      }
    } else {
      showAdminLoginModal();
    }
  });
  
  // Update admin UI state
  updateAdminUIState();
});

// Function to handle map click events for both right-click and double-click
function handleMapClick(e) {
  const mapOffset = $('#game-map').offset();
  const clickX = (e.pageX - mapOffset.left) / currentZoom;
  const clickY = (e.pageY - mapOffset.top) / currentZoom;
  const clickedPoi = $(e.target).closest('.poi-marker');

  // If we're in add mode, handle it differently
  if (addMode) {
    // Apply the offsets and scaling factor for the form
    const mapX = Math.round(clickX);
    const mapY = Math.round(clickY - MAP_HEIGHT);
    const adjustedX = (mapX - offsetX) * 1.664;
    const adjustedY = (mapY - offsetY) * 1.664;

    // Set the coordinates in the form
    $('#poi-x').val(formatCoordinate(adjustedX));
    $('#poi-y').val(formatCoordinate(adjustedY));

    // Show the form
    $('#poi-form').show();
    $('#poi-type').focus();
    
    // Check for nearby POIs
    checkNearbyPoisFromForm();
    return;
  }

  if (clickedPoi.length) {
    // POI clicks are now handled by the POI marker click handler
    // This prevents double handling of the click event
    return;
  } else {
    // If clicking on empty space, deselect any selected POI (unless ctrl is held)
    if ((selectedPoi || selectedPois.length > 0) && !e.ctrlKey) {
      selectedPoi = null;
      selectedPois = [];
      $('.poi-marker').removeClass('selected multi-selected');
      // Clear group highlighting
      $('.poi-group-header').removeClass('highlighted');
      updateSelectionIndicator();
      updateUrlWithSelection();
    }
    
    // Only show context menu for right-click or double-click
    // This is determined by the event type that triggered this function
    if (e.type === 'contextmenu' || e.type === 'dblclick') {
      // Apply the same coordinate adjustments as in handleAddModeClick
      const mapX = Math.round(clickX);
      const mapY = Math.round(clickY - MAP_HEIGHT);
      
      // Apply the offsets and scaling factor
      const adjustedX = (mapX - offsetX) * 1.664;
      const adjustedY = (mapY - offsetY) * 1.664;
      
      showContextMenu(e.pageX, e.pageY, adjustedX, adjustedY);
    }
  }
  
  // Track map clicks
  trackMapInteraction('click', {
    coordinates: `${clickX},${clickY}`
  });
}

// Function to update zoom level indicator
function updateZoomIndicator() {
  // Create build info indicator if it doesn't exist
  if ($('#build-info').length === 0) {
    const buildInfo = $('<div id="build-info">Work in progress, CPT3 data</div>');
    buildInfo.css({
      'position': 'absolute',
      'bottom': '40px',
      'left': '10px',
      'background-color': 'rgba(0, 0, 0, 0.7)',
      'color': '#ffd700', // Gold color for emphasis
      'padding': '5px 10px',
      'border-radius': '4px',
      'z-index': '20',
      'font-size': '14px',
      'font-weight': 'bold'
    });
    $('#map-container').append(buildInfo);
  }

  // Create zoom indicator if it doesn't exist
  if ($('#zoom-level').length === 0) {
    const zoomIndicator = $('<div id="zoom-level"></div>');
    zoomIndicator.css({
      'position': 'absolute',
      'bottom': '10px',
      'left': '10px',
      'background-color': 'rgba(0, 0, 0, 0.7)',
      'color': 'white',
      'padding': '5px 10px',
      'border-radius': '4px',
      'z-index': '20',
      'font-size': '14px'
    });
    $('#map-container').append(zoomIndicator);
  }
  
  // Update zoom level text
  const zoomPercent = Math.round(currentZoom * 100);
  $('#zoom-level').text(`Zoom: ${zoomPercent}%`);
}

// Function to show session management UI
function showSessionManagement() {
  // Clear any existing auto-hide timers
  if (window.sessionUITimer) {
    clearTimeout(window.sessionUITimer);
  }
  
  // Create session management UI if it doesn't exist
  if ($('#session-management').length === 0) {
    const sessionUI = $(`
      <div id="session-management" style="position: absolute; top: 50px; left: 10px; background-color: rgba(0, 0, 0, 0.7); color: white; padding: 10px; border-radius: 4px; z-index: 20; font-size: 14px; max-width: 250px;">
        <h3 style="margin: 0 0 10px 0; font-size: 16px;">Session Management</h3>
        <p style="margin: 0 0 10px 0; font-size: 12px;">
          You can delete POIs you created in this session. They are marked with a green dot.
        </p>
        <div style="margin: 0 0 10px 0; font-size: 11px; color: #aaa;">
          This popup will automatically close in <span id="session-timer">5</span> seconds.
        </div>
        <button id="new-session-btn" style="background-color: #4CAF50; color: white; border: none; padding: 5px 10px; border-radius: 3px; cursor: pointer;">Start New Session</button>
        <button id="hide-session-ui-btn" style="background-color: #607d8b; color: white; border: none; padding: 5px 10px; border-radius: 3px; cursor: pointer; margin-left: 5px;">Hide</button>
      </div>
    `);
    
    $('#map-container').append(sessionUI);
    
    // Add event handlers
    $('#new-session-btn').on('click', function() {
      if (confirm('Starting a new session will prevent you from deleting POIs created in previous sessions. Continue?')) {
        // Generate a new session ID
        sessionId = 'session-' + Date.now() + '-' + Math.random().toString(36).substring(2, 15);
        localStorage.setItem(SESSION_KEY, sessionId);
        showNotification('New session started. You can now create and delete new POIs.');
        renderPois(); // Re-render to update session indicators
        
        // Reset the auto-hide timer when starting a new session
        resetSessionUITimer();
      }
    });
    
    $('#hide-session-ui-btn').on('click', function() {
      $('#session-management').hide();
      // Clear the timer when manually hiding
      if (window.sessionUITimer) {
        clearTimeout(window.sessionUITimer);
      }
    });
    
    // Mouse over the session UI should pause the timer
    $('#session-management').on('mouseenter', function() {
      // Clear the timer when hovering
      if (window.sessionUITimer) {
        clearTimeout(window.sessionUITimer);
        $('#session-timer').text('paused');
      }
    });
    
    // Mouse leaving the session UI should restart the timer
    $('#session-management').on('mouseleave', function() {
      resetSessionUITimer();
    });
  } else {
    // If it exists, just show it
    $('#session-management').show();
  }
  
  // Start the auto-hide timer
  resetSessionUITimer();
}

// Function to reset the session UI timer
function resetSessionUITimer() {
  // Clear any existing timer
  if (window.sessionUITimer) {
    clearTimeout(window.sessionUITimer);
  }
  
  let secondsLeft = 5;
  
  // Update the timer text
  $('#session-timer').text(secondsLeft);
  
  // Create a countdown interval
  const countdownInterval = setInterval(function() {
    secondsLeft--;
    $('#session-timer').text(secondsLeft);
    
    if (secondsLeft <= 0) {
      clearInterval(countdownInterval);
    }
  }, 1000);
  
  // Set the auto-hide timer
  window.sessionUITimer = setTimeout(function() {
    $('#session-management').fadeOut(500);
    clearInterval(countdownInterval);
  }, 5000);
}

// Format coordinate with specified decimal precision
function formatCoordinateWithPrecision(value, precision) {
  const sign = value >= 0 ? '+' : '-';
  return sign + value.toFixed(precision);
}

// Function to initialize or retrieve the session ID
function initSessionId() {
  // Try to get existing session ID from localStorage
  let existingSessionId = localStorage.getItem(SESSION_KEY);
  
  // If no session ID exists, generate a new one
  if (!existingSessionId) {
    existingSessionId = 'session_' + Date.now() + '_' + Math.random().toString(36).substring(2, 15);
    localStorage.setItem(SESSION_KEY, existingSessionId);
  }
  
  // Set the global sessionId
  sessionId = existingSessionId;
}

// Add keyboard shortcuts for zooming
$(document).on('keydown', function(e) {
  // Only handle keyboard shortcuts if not typing in an input field
  if (!$(e.target).is('input, textarea, select')) {
    const containerWidth = $('#map-container').width();
    const containerHeight = $('#map-container').height();
    
    // Plus key (+) to zoom in
    if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      changeZoom(0.2, containerWidth / 2, containerHeight / 2);
    }
    // Minus key (-) to zoom out
    else if (e.key === '-' || e.key === '_') {
      e.preventDefault();
      changeZoom(-0.2, containerWidth / 2, containerHeight / 2);
    }
    // 0 key to reset view
    else if (e.key === '0') {
      e.preventDefault();
      resetMapView();
    }
  }
});

// Toggle heatmap visibility
function toggleHeatmap() {
  isHeatmapVisible = !isHeatmapVisible;
  
  // If the image is preloaded, toggle immediately
  // Otherwise, show a loading indicator
  if (heatmapImagePreloaded) {
    $('#heatmap-overlay').toggle(isHeatmapVisible);
  } else {
    if (isHeatmapVisible) {
      showNotification('Loading heatmap...');
      const heatmapImage = new Image();
      heatmapImage.onload = function() {
        $('#heatmap-overlay').show();
        heatmapImagePreloaded = true;
      };
      heatmapImage.src = 'maps/Maynard_Heatmap_Transparent.png';
    } else {
      $('#heatmap-overlay').hide();
    }
  }
  
  $('#toggle-heatmap').toggleClass('active', isHeatmapVisible);
  trackEvent('ToggleHeatmap', {
    visible: isHeatmapVisible
  });
}

// Toggle guide visibility
function toggleGuide() {
  isGuideVisible = !isGuideVisible;
  
  // If the image is preloaded, toggle immediately
  // Otherwise, show a loading indicator
  if (guideImagePreloaded) {
    $('#guide-overlay').toggle(isGuideVisible);
  } else {
    if (isGuideVisible) {
      showNotification('Loading guide...');
      const guideImage = new Image();
      guideImage.onload = function() {
        $('#guide-overlay').show();
        guideImagePreloaded = true;
      };
      guideImage.src = 'maps/Maynard_Guide_Transparent.png';
    } else {
      $('#guide-overlay').hide();
    }
  }
  
  $('#toggle-guide').toggleClass('active', isGuideVisible);

  // Update URL with guide parameter
  const url = new URL(window.location);
  if (isGuideVisible) {
    url.searchParams.set('guide', '1');
  } else {
    url.searchParams.delete('guide');
  }
  window.history.replaceState({}, '', url);

  trackEvent('ToggleGuide', {
    visible: isGuideVisible
  });
}


// Function to center the map on selected POIs
function centerMapOnSelectedPois() {
  if (selectedPois.length === 0) return;
  
  if (selectedPois.length === 1) {
    // If only one POI is selected, center on it
    const poiId = selectedPois[0];
    const poi = pois.find(p => p.id === poiId);
    if (poi) {
      // Calculate the real coordinates on the map
      const realX = (poi.x / 1.664) + offsetX;
      const realY = (poi.y / 1.664) + offsetY + MAP_HEIGHT;
      
      // Center the map on this POI
      const containerWidth = $('#map-container').width();
      const containerHeight = $('#map-container').height();
      
      mapPosition.x = (containerWidth / 2) - (realX * currentZoom);
      mapPosition.y = (containerHeight / 2) - (realY * currentZoom);
      
      // Apply boundary constraints
      applyMapBoundaryConstraints(containerWidth, containerHeight);
      
      // Update the map transform
      updateMapTransform();
      
      showNotification(`Centered map on selected POI`);
    }
  } else {
    // If multiple POIs are selected, calculate the bounding box
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    
    // Find the bounds of all selected POIs
    let validPoisCount = 0;
    selectedPois.forEach(poiId => {
      const poi = pois.find(p => p.id === poiId);
      if (poi) {
        validPoisCount++;
        const realX = (poi.x / 1.664) + offsetX;
        const realY = (poi.y / 1.664) + offsetY + MAP_HEIGHT;
        
        minX = Math.min(minX, realX);
        minY = Math.min(minY, realY);
        maxX = Math.max(maxX, realX);
        maxY = Math.max(maxY, realY);
      }
    });
    
    // Only proceed if we have valid POIs to center on
    if (validPoisCount === 0) return;
    
    // Calculate the center of the bounding box
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    
    // Calculate the size of the bounding box
    const width = maxX - minX;
    const height = maxY - minY;
    
    // Calculate the zoom level to fit the bounding box
    const containerWidth = $('#map-container').width();
    const containerHeight = $('#map-container').height();
    
    // Add padding around the bounding box (increased from 200 to 300)
    const padding = 300;
    
    // Ensure we have a minimum size to prevent division by zero or tiny values
    const minSize = 1;
    const safeWidth = Math.max(width, minSize);
    const safeHeight = Math.max(height, minSize);
    
    // Calculate zoom levels that would fit the content in the container
    const zoomX = (containerWidth - padding) / safeWidth;
    const zoomY = (containerHeight - padding) / safeHeight;
    
    // Use the smaller zoom level to ensure all POIs are visible
    // Reduced the cap from 1.5 to 1.2 to allow more zoom-out for widely spread POIs
    const newZoom = Math.min(zoomX, zoomY, 1.2);
    
    // Set the new zoom level
    currentZoom = newZoom;
    
    // Center the map on the bounding box
    mapPosition.x = (containerWidth / 2) - (centerX * currentZoom);
    mapPosition.y = (containerHeight / 2) - (centerY * currentZoom);
    
    // Apply boundary constraints
    applyMapBoundaryConstraints(containerWidth, containerHeight);
    
    // Update the map transform
    updateMapTransform();
    
    showNotification(`Centered map on ${selectedPois.length} selected POIs`);
  }
}

// Function to clear 'group' and 'select' parameters from the URL
function clearUrlParameters() {
  // Create the base URL
  let newUrl = window.location.pathname;
  let params = [];
  
  // Add any other existing parameters except 'group', 'locations', and 'select'
  const urlParams = new URLSearchParams(window.location.search);
  for (const [key, value] of urlParams.entries()) {
    if (key !== 'group' && key !== 'locations' && key !== 'select') {
      params.push(`${key}=${encodeURIComponent(value)}`);
    }
  }
  
  // Append parameters to URL
  if (params.length > 0) {
    newUrl += '?' + params.join('&');
  }
  
  // Update the URL without reloading the page
  window.history.replaceState({}, document.title, newUrl);
}

// Function to center the map on POIs of a specific type
function centerMapOnPoisOfType(type) {
  // Create a temporary array of POIs of the selected type to center the map on
  const visiblePois = pois.filter(poi => poi.type === type && poi.visible);
  
  // Only center the map if there are visible POIs of the selected type
  if (visiblePois.length > 0) {
    // Create temporary selectedPois array for centering
    const tempSelectedPois = visiblePois.map(poi => poi.id);
    
    // Store original selectedPois
    const originalSelectedPois = selectedPois;
    
    // Temporarily set selectedPois to the filtered POIs
    selectedPois = tempSelectedPois;
    
    // Center the map on the filtered POIs
    centerMapOnSelectedPois();
    
    // Restore original selectedPois
    selectedPois = originalSelectedPois;
    
    // Show notification with count
    showNotification(`Centered map on ${visiblePois.length} ${type} POIs`);
  } else {
    showNotification(`No visible ${type} POIs to center on`, true);
  }
}

// Function to center the map on unapproved POIs
function centerMapOnUnapprovedPois() {
  // Create a temporary array of unapproved POIs to center the map on
  const visiblePois = pois.filter(poi => !poi.approved && poi.visible);
  
  // Only center the map if there are visible unapproved POIs
  if (visiblePois.length > 0) {
    // Create temporary selectedPois array for centering
    const tempSelectedPois = visiblePois.map(poi => poi.id);
    
    // Store original selectedPois
    const originalSelectedPois = selectedPois;
    
    // Temporarily set selectedPois to the filtered POIs
    selectedPois = tempSelectedPois;
    
    // Center the map on the filtered POIs
    centerMapOnSelectedPois();
    
    // Restore original selectedPois
    selectedPois = originalSelectedPois;
    
    // Show notification with count
    showNotification(`Centered map on ${visiblePois.length} unapproved POIs`);
  } else {
    showNotification('No visible unapproved POIs to center on', true);
  }
}

// Function to apply boundary constraints to the map position
function applyMapBoundaryConstraints(containerWidth, containerHeight) {
  // Get the current state - are we centering on POIs?
  const isCenteringOnPois = selectedPois.length > 0;
  
  // Allow some extra margin when centering on POIs
  const extraMargin = isCenteringOnPois ? 0.3 : 0; // 30% extra margin when centering (increased from 20%)
  
  // Ensure the map doesn't go beyond the viewport boundaries
  if (MAP_WIDTH * currentZoom < containerWidth) {
    // If the map is smaller than the container, center it horizontally
    mapPosition.x = (containerWidth / currentZoom - MAP_WIDTH) / 2;
  } else {
    // If the map is larger than the container, constrain it to the boundaries
    // Allow extra margin when centering on POIs
    const minX = containerWidth / currentZoom - MAP_WIDTH - (MAP_WIDTH * extraMargin);
    const maxX = MAP_WIDTH * extraMargin;
    mapPosition.x = Math.max(minX, Math.min(maxX, mapPosition.x));
  }

  if (MAP_HEIGHT * currentZoom < containerHeight) {
    // If the map is smaller than the container, center it vertically
    mapPosition.y = (containerHeight / currentZoom - MAP_HEIGHT) / 2;
  } else {
    // If the map is larger than the container, constrain it to the boundaries
    // Allow extra margin when centering on POIs
    const minY = containerHeight / currentZoom - MAP_HEIGHT - (MAP_HEIGHT * extraMargin);
    const maxY = MAP_HEIGHT * extraMargin;
    mapPosition.y = Math.max(minY, Math.min(maxY, mapPosition.y));
  }
}

// Function to preload overlay images
function preloadOverlayImages() {
  // Preload heatmap image
  const heatmapImage = new Image();
  heatmapImage.onload = function() {
    heatmapImagePreloaded = true;
  };
  heatmapImage.src = 'maps/Maynard_Heatmap_Transparent.png';
  
  // Preload guide image
  const guideImage = new Image();
  guideImage.onload = function() {
    guideImagePreloaded = true;
  };
  guideImage.src = 'maps/Maynard_Guide_Transparent.png';
}














// Add this near the top of your file, after other initializations
let appInsights;
if (window.appInsights) {
    appInsights = window.appInsights;
    // Track initial page view with map details
    appInsights.trackPageView({
        name: 'ExoborneMaps',
        properties: {
            mapType: 'maynard'
        }
    });
}

// Add telemetry tracking function
function trackEvent(eventName, properties = {}) {
    if (appInsights) {
        // Add common properties to all events
        const commonProps = {
            sessionId: window.sessionId || 'unknown',
            mapType: document.getElementById('map-select-overlay').value,
            screenResolution: `${window.innerWidth}x${window.innerHeight}`
        };
        appInsights.trackEvent({ 
            name: eventName, 
            properties: { ...commonProps, ...properties }
        });
    }
}

// Add error tracking function
function trackError(error, properties = {}) {
    if (appInsights) {
        appInsights.trackException({
            error: error,
            properties: {
                sessionId: window.sessionId || 'unknown',
                ...properties
            }
        });
    }
}

// Track map interactions with throttling
let lastMapInteraction = Date.now();
function trackMapInteraction(interactionType, properties = {}) {
    const now = Date.now();
    if (now - lastMapInteraction >= 1000) { // Throttle to once per second
        trackEvent('MapInteraction', {
            type: interactionType,
            ...properties
        });
        lastMapInteraction = now;
    }
}

// Track errors globally
window.onerror = function(msg, url, line, col, error) {
    trackError(error || new Error(msg), {
        url: url,
        line: line,
        col: col
    });
    return false;
};

// Track unhandled promise rejections
window.addEventListener('unhandledrejection', function(event) {
    trackError(event.reason, {
        type: 'UnhandledPromiseRejection'
    });
});

// Function to check URL parameters for initial state
function checkUrlParameters() {
    const urlParams = new URLSearchParams(window.location.search);
    const guideParam = urlParams.get('guide');
    const lootParam = urlParams.get('loot');
    const categoryParam = urlParams.get('category');
    const canEditParam = urlParams.get('canEdit');
    
    // Check for guide parameter
    if (guideParam === '1') {
        // Show guide overlay
        isGuideVisible = true;
        $('#guide-overlay').show();
        $('#toggle-guide').addClass('active');
    } else if (guideParam === '0') {
        // Show heatmap instead
        isHeatmapVisible = true;
        $('#heatmap-overlay').show();
        $('#toggle-heatmap').addClass('active');
    }
    
    // Check for loot parameter to open the Other Loot modal
    if (lootParam === '1') {
        // Show the Other Loot modal
        $('#other-loot-modal').css('display', 'block');
        
        // Apply category filter if specified
        if (categoryParam) {
            // Make sure the category exists
            const validCategories = ['all', 'resources', 'weapons', 'armor', 'consumables', 'tools'];
            if (validCategories.includes(categoryParam)) {
                filterLootByCategory(categoryParam);
            }
        }
        
        // Track event if analytics is available
        if (typeof trackEvent === 'function') {
            trackEvent('other_loot_opened_from_url', { category: categoryParam || 'all' });
        }
    }
    
    // Update admin UI state based on URL parameters
    updateAdminUIState();
}

// Function to update URL with loot parameter
function updateUrlWithLootParam(showLoot) {
  const url = new URL(window.location.href);
  
  // Preserve existing parameters
  const existingParams = new URLSearchParams(window.location.search);
  
  if (showLoot) {
    url.searchParams.set('loot', '1');
  } else {
    url.searchParams.delete('loot');
  }
  
  // Update URL without reloading the page
  window.history.replaceState({}, '', url);
}

// Function to filter loot items by category
function filterLootByCategory(category) {
  // Remove active class from all buttons
  $('.category-btn').removeClass('active');
  
  // Add active class to the selected category button
  $(`.category-btn[data-category="${category}"]`).addClass('active');
  
  // Show/hide items based on category
  $('.loot-item').each(function() {
    if (category === 'all' || $(this).data('category') === category) {
      $(this).show();
    } else {
      $(this).hide();
    }
  });
}

// Function to update URL with loot and category parameters
function updateUrlWithLootParam(showLoot, category = null) {
  const url = new URL(window.location.href);
  
  // Preserve existing parameters
  const existingParams = new URLSearchParams(window.location.search);
  
  if (showLoot) {
    url.searchParams.set('loot', '1');
    
    // Add category parameter if provided
    if (category && category !== 'all') {
      url.searchParams.set('category', category);
    } else {
      url.searchParams.delete('category');
    }
  } else {
    url.searchParams.delete('loot');
    url.searchParams.delete('category');
  }
  
  // Update URL without reloading the page
  window.history.replaceState({}, '', url);
}

// Function to close the Other Loot modal
function closeOtherLootModal() {
  $('#other-loot-modal').css('display', 'none');
  
  // Remove loot parameter from URL
  updateUrlWithLootParam(false);
}

// Function to check for nearby POIs of the same type
function checkForNearbyPois(x, y, type, radius = 10) {
  // Convert coordinates to numbers to ensure proper comparison
  const numX = parseFloat(x);
  const numY = parseFloat(y);
  
  if (isNaN(numX) || isNaN(numY)) return [];
  
  // Find POIs of the same type within the specified radius
  const nearbyPois = pois.filter(poi => {
    // Only check POIs of the same type
    if (poi.type !== type) return false;
    
    // Calculate distance using Euclidean distance formula
    const distance = Math.sqrt(
      Math.pow(poi.x - numX, 2) + 
      Math.pow(poi.y - numY, 2)
    );
    
    // Return true if the POI is within the radius
    return distance <= radius;
  });
  
  return nearbyPois;
}

// Function to check for nearby POIs based on form inputs
function checkNearbyPoisFromForm() {
  // Get values from form
  const x = $('#poi-x').val();
  const y = $('#poi-y').val();
  const type = $('#poi-type').val();
  
  // Clear any existing warning
  $('#nearby-poi-warning').hide().empty();
  
  // Only proceed if both coordinates are entered
  if (!x || !y || x.length < 2 || y.length < 2) {
    return;
  }
  
  // Convert coordinates to numbers (removing + sign if present)
  const numX = parseFloat(x.replace(/^\+/, ''));
  const numY = parseFloat(y.replace(/^\+/, ''));
  
  // Check for nearby POIs
  const nearbyPois = checkForNearbyPois(numX, numY, type);
  
  // If nearby POIs found, show warning
  if (nearbyPois.length > 0) {
    const warningEl = $('#nearby-poi-warning');
    
    // Create warning message
    let message = `<strong>Warning:</strong> Found ${nearbyPois.length} ${type} POI${nearbyPois.length > 1 ? 's' : ''} nearby:`;
    
    // Add details for each nearby POI
    message += '<ul>';
    nearbyPois.forEach(poi => {
      const distance = Math.sqrt(
        Math.pow(poi.x - numX, 2) + 
        Math.pow(poi.y - numY, 2)
      ).toFixed(1);
      
      message += `<li>At X: <span style="color: #ffd700">${formatCoordinate(poi.x)}</span>, Y: <span style="color: #ffd700">${formatCoordinate(poi.y)}</span> <span style="color: #aaa">(${distance} units away)</span>`;
      if (poi.description) {
        message += `<br><span style="color: #ccc; font-style: italic; margin-left: 5px;">${poi.description.substring(0, 40)}${poi.description.length > 40 ? '...' : ''}</span>`;
      }
      message += '</li>';
    });
    message += '</ul>';
    message += '<div style="margin-top: 5px;">Please check if this is a duplicate before saving.</div>';
    
    // Show warning with fade-in effect
    warningEl.html(message).fadeIn(300);
  }
}

// Function to check for nearby POIs from context menu
function checkNearbyPoisFromContext(mapX, mapY, type) {
  // Clear any existing warning
  $('#context-nearby-warning').hide().empty();
  
  // Check for nearby POIs
  const nearbyPois = checkForNearbyPois(mapX, mapY, type);
  
  // If nearby POIs found, show warning
  if (nearbyPois.length > 0) {
    const warningEl = $('#context-nearby-warning');
    
    // Create warning message
    let message = `<strong>Warning:</strong> Found ${nearbyPois.length} ${type} POI${nearbyPois.length > 1 ? 's' : ''} nearby:`;
    
    // Add details for each nearby POI
    message += '<ul>';
    nearbyPois.forEach(poi => {
      const distance = Math.sqrt(
        Math.pow(poi.x - mapX, 2) + 
        Math.pow(poi.y - mapY, 2)
      ).toFixed(1);
      
      message += `<li>At X: <span style="color: #ffd700">${formatCoordinate(poi.x)}</span>, Y: <span style="color: #ffd700">${formatCoordinate(poi.y)}</span> <span style="color: #aaa">(${distance} units away)</span>`;
      if (poi.description) {
        message += `<br><span style="color: #ccc; font-style: italic; margin-left: 5px;">${poi.description.substring(0, 40)}${poi.description.length > 40 ? '...' : ''}</span>`;
      }
      message += '</li>';
    });
    message += '</ul>';
    message += '<div style="margin-top: 5px;">Please check if this is a duplicate before saving.</div>';
    
    // Show warning with fade-in effect
    warningEl.html(message).fadeIn(300);
  }
}

// Function to show duplicate POI confirmation modal
function showDuplicateConfirmModal(nearbyPois, type, callback) {
  // Create warning message
  let message = `<strong>Warning:</strong> Found ${nearbyPois.length} ${type} POI${nearbyPois.length > 1 ? 's' : ''} nearby:`;
  
  // Add details for each nearby POI
  message += '<ul>';
  nearbyPois.forEach(poi => {
    const distance = Math.sqrt(
      Math.pow(poi.x - parseFloat($('#poi-x').val().replace(/^\+/, '')), 2) + 
      Math.pow(poi.y - parseFloat($('#poi-y').val().replace(/^\+/, '')), 2)
    ).toFixed(1);
    
    message += `<li>At X: ${formatCoordinate(poi.x)}, Y: ${formatCoordinate(poi.y)} (${distance} units away)`;
    if (poi.description) {
      message += ` - "${poi.description.substring(0, 30)}${poi.description.length > 30 ? '...' : ''}"`;
    }
    message += '</li>';
  });
  message += '</ul>';
  message += 'This may be a duplicate of an existing POI.';
  
  // Set the warning message
  $('#duplicate-modal-warning').html(message);
  
  // Show the modal
  $('#duplicate-confirm-modal').css('display', 'block');
  
  // Set up event handlers
  $('#duplicate-confirm-btn').off('click').on('click', function() {
    $('#duplicate-confirm-modal').css('display', 'none');
    if (callback) callback(true);
  });
  
  $('#duplicate-cancel-btn, #duplicate-modal-close').off('click').on('click', function() {
    $('#duplicate-confirm-modal').css('display', 'none');
    if (callback) callback(false);
  });
  
  // Close when clicking outside the modal content
  $('#duplicate-confirm-modal').off('click').on('click', function(event) {
    if (event.target === this) {
      $('#duplicate-confirm-modal').css('display', 'none');
      if (callback) callback(false);
    }
  });
  
  // Close with Escape key
  $(document).off('keydown.duplicateModal').on('keydown.duplicateModal', function(event) {
    if (event.key === 'Escape' && $('#duplicate-confirm-modal').css('display') === 'block') {
      $('#duplicate-confirm-modal').css('display', 'none');
      if (callback) callback(false);
      $(document).off('keydown.duplicateModal');
    }
  });
}

// Function to show duplicate POI confirmation modal for context menu
function showDuplicateConfirmModalForContext(nearbyPois, mapX, mapY, type, callback) {
  // Create warning message
  let message = `<strong>Warning:</strong> Found ${nearbyPois.length} ${type} POI${nearbyPois.length > 1 ? 's' : ''} nearby:`;
  
  // Add details for each nearby POI
  message += '<ul>';
  nearbyPois.forEach(poi => {
    const distance = Math.sqrt(
      Math.pow(poi.x - mapX, 2) + 
      Math.pow(poi.y - mapY, 2)
    ).toFixed(1);
    
    message += `<li>At X: ${formatCoordinate(poi.x)}, Y: ${formatCoordinate(poi.y)} (${distance} units away)`;
    if (poi.description) {
      message += ` - "${poi.description.substring(0, 30)}${poi.description.length > 30 ? '...' : ''}"`;
    }
    message += '</li>';
  });
  message += '</ul>';
  message += 'This may be a duplicate of an existing POI.';
  
  // Set the warning message
  $('#duplicate-modal-warning').html(message);
  
  // Show the modal
  $('#duplicate-confirm-modal').css('display', 'block');
  
  // Set up event handlers
  $('#duplicate-confirm-btn').off('click').on('click', function() {
    $('#duplicate-confirm-modal').css('display', 'none');
    if (callback) callback(true);
  });
  
  $('#duplicate-cancel-btn, #duplicate-modal-close').off('click').on('click', function() {
    $('#duplicate-confirm-modal').css('display', 'none');
    if (callback) callback(false);
  });
  
  // Close when clicking outside the modal content
  $('#duplicate-confirm-modal').off('click').on('click', function(event) {
    if (event.target === this) {
      $('#duplicate-confirm-modal').css('display', 'none');
      if (callback) callback(false);
    }
  });
  
  // Close with Escape key
  $(document).off('keydown.duplicateModal').on('keydown.duplicateModal', function(event) {
    if (event.key === 'Escape' && $('#duplicate-confirm-modal').css('display') === 'block') {
      $('#duplicate-confirm-modal').css('display', 'none');
      if (callback) callback(false);
      $(document).off('keydown.duplicateModal');
    }
  });
}

// Function to convert hex color to RGB
function hexToRgb(hex) {
  // Remove the hash if it exists
  hex = hex.replace(/^#/, '');
  
  // Parse the hex values
  let bigint = parseInt(hex, 16);
  let r = (bigint >> 16) & 255;
  let g = (bigint >> 8) & 255;
  let b = bigint & 255;
  
  return { r, g, b };
}

// Function to lighten a color by a percentage
function lightenColor(hex, percent) {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  
  // Calculate the lighter values
  const lighter = {
    r: Math.min(255, Math.floor(rgb.r + (255 - rgb.r) * (percent / 100))),
    g: Math.min(255, Math.floor(rgb.g + (255 - rgb.g) * (percent / 100))),
    b: Math.min(255, Math.floor(rgb.b + (255 - rgb.b) * (percent / 100)))
  };
  
  // Convert back to hex
  return `#${(1 << 24 | lighter.r << 16 | lighter.g << 8 | lighter.b).toString(16).slice(1)}`;
}

// Function to darken a color by a percentage
function darkenColor(hex, percent) {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  
  // Calculate the darker values
  const darker = {
    r: Math.max(0, Math.floor(rgb.r * (1 - percent / 100))),
    g: Math.max(0, Math.floor(rgb.g * (1 - percent / 100))),
    b: Math.max(0, Math.floor(rgb.b * (1 - percent / 100)))
  };
  
  // Convert back to hex
  return `#${(1 << 24 | darker.r << 16 | darker.g << 8 | darker.b).toString(16).slice(1)}`;
}

// Function to update the admin UI state based on login status
function updateAdminUIState() {
  const isAdmin = hasEditPermission();
  const urlParams = new URLSearchParams(window.location.search);
  const canEdit = urlParams.get('canEdit') === '1';
  
  // Show/hide the admin controls section based on URL parameter
  $('.admin-controls').toggle(canEdit);
  
  // Update admin button text
  if (isAdmin) {
    $('#admin-login-btn').text('Admin Options');
    
    // Update admin status indicator
    $('#admin-status').html('<span class="admin-indicator">👑 Admin</span><button id="admin-logout-btn">Logout</button>').show();
    
    // Add logout button handler
    $('#admin-logout-btn').on('click', function(e) {
      e.stopPropagation(); // Prevent triggering the parent button
      logoutAdmin();
    });
  } else {
    $('#admin-login-btn').text('Admin Login');
    $('#admin-status').hide().empty();
  }
  
  // Update UI elements that depend on admin status
  $('#show-unapproved-btn').toggle(isAdmin);
}
