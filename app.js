// Global offsets
let offsetX = 602; // Change this to your desired X offset
let offsetY = -248; // Change this to your desired Y offset

// Configuration
// Determine if we're running locally or in production (Azure)
const isLocalhost = window.location.hostname === 'localhost' || 
                    window.location.hostname === '127.0.0.1' ||
                    window.location.hostname.includes('192.168.');

// Use localhost URL for local development, just '/api' for production
const API_ENDPOINT = isLocalhost ? 'http://localhost:8080/api' : '/api';

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

// Check if user has edit permissions based on URL parameter
function hasEditPermission() {
  const urlParams = new URLSearchParams(window.location.search);
  const canEdit = urlParams.get('canEdit') === '1';
  console.log('URL params:', window.location.search);
  console.log('canEdit from URL:', urlParams.get('canEdit'));
  console.log('hasEditPermission result:', canEdit);
  return canEdit;
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
          <option value="machinery">Machinery Parts</option>
          <option value="electronics">Electronics</option>
          <option value="secret">Secret</option>
          <option value="ec-kits">EC Kits</option>
          <option value="collectibles">Collectibles</option>
          <option value="loot">Loot</option>
          <option value="container">Locked Containers</option>
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
    console.log('Loaded POIs:', { approved: approvedPois.length, draft: draftPois.length });
    
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
    
    // Only render POIs if we're not skipping rendering
    if (!skipRendering) {
      console.log("loadPoisFromFile: rendering POIs, addMode =", addMode);
      renderPois();
      savePoisToStorage();
    } else {
      console.log("loadPoisFromFile: skipping rendering, addMode =", addMode);
    }
    
    // Update last sync time
    lastSyncTime = Date.now();
    
    showNotification(`Loaded ${pois.length} POIs successfully`);
    
    // Update groups from URL after POIs are loaded
    updateGroupsFromUrl();
    
    // Process URL selected POIs after POIs are loaded
    processUrlSelectedPois();
  })
  .catch(error => {
    console.error('Error in POI loading process:', error);
    showNotification('Error loading POIs from server', true);
  });
}

// Map interaction functions
function startDragging(e) {
  if (addMode) {
    // In add mode, clicking creates a POI instead of dragging
    const mapOffset = $('#game-map').offset();
    const clickX = (e.pageX - mapOffset.left) / currentZoom;
    const clickY = (e.pageY - mapOffset.top) / currentZoom;

    tempPoi = {
      id: 'temp-' + Date.now(),
      name: `POI-${Date.now().toString().slice(-4)}`,
      type: 'shelter',
      description: '',
      x: clickX,
      y: clickY,
      visible: true
    };

    // Show the form
    $('#poi-type').val('shelter');
    $('#poi-desc').val('');
    $('#poi-form').show();
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
  console.log("toggleAddMode called, current addMode:", addMode);
  addMode = !addMode;
  console.log("toggleAddMode: new addMode value:", addMode);
  $('#add-mode-btn').toggleClass('active', addMode);

  if (addMode) {
    console.log("toggleAddMode: showing form");
    $('#game-map').css('cursor', 'crosshair');
    $('#poi-form').show();
    console.log("toggleAddMode: form display style:", $('#poi-form').css('display'));
    
    // Force the form to be visible if it's not already
    if ($('#poi-form').css('display') === 'none') {
      console.log("toggleAddMode: forcing form to be visible");
      $('#poi-form').css('display', 'block');
    }
    
    $('#poi-x').val('');
    $('#poi-y').val('');
    $('#poi-desc').val('');
    showNotification('Click on the map to add a POI or enter coordinates manually');

    // Hide heatmap overlay when adding POIs
    if (isHeatmapVisible) {
      toggleHeatmap();
    }
  } else {
    console.log("toggleAddMode: hiding form");
    $('#game-map').css('cursor', 'default');
    $('#poi-form').hide();
    tempPoi = null;
  }
}

// Function to format coordinates as strings with signs
const formatCoordinateForStorage = (value) => {
    const roundedValue = Math.round(value);
    const sign = roundedValue >= 0 ? '+' : '-';
    return sign + String(Math.abs(roundedValue)).padStart(4, '0');
};

function savePoi() {
  const poiType = $('#poi-type').val().trim();
  const poiColor = getPoiColor(poiType);
  const manualX = $('#poi-x').val().trim();
  const manualY = $('#poi-y').val().trim();
  
  // Check if coordinates were manually entered
  if (manualX && manualY) {
    // Create POI with manually entered coordinates
    const poi = {
      id: 'poi-' + Date.now(),
      name: poiType.charAt(0).toUpperCase() + poiType.slice(1),
      type: poiType,
      description: $('#poi-desc').val().trim(),
      x: manualX.startsWith('+') || manualX.startsWith('-') ? manualX : '+' + manualX,
      y: manualY.startsWith('+') || manualY.startsWith('-') ? manualY : '+' + manualY,
      visible: true,
      approved: false,
      dateAdded: new Date().toISOString(),
      sessionId: sessionId // Add session ID to track who created this POI
    };
    
    pois.push(poi);
    renderPois();
    savePoisToStorage();
    
    // Send unapproved POI to server
    saveUnapprovedPoi(poi);
    
    // Check if we have multiple POIs selected in the URL
    const manualParams = getUrlParameters();
    if (manualParams.select && manualParams.select.split(',').length > 1) {
      // Add the new POI to the selected POIs list
      selectedPois.push(poi.id);
      selectedPoi = poi.id; // Make the new POI the primary selection
      
      // Update the URL with the new selection
      updateUrlWithSelection();
      
      // Ensure the new POI is visible
      poi.visible = true;
      
      // Update the visual state of the POI marker
      const marker = $(`.poi-marker[data-id="${poi.id}"]`);
      marker.addClass('selected');
      
      // Apply styling to the marker
      const poiColor = getPoiColor(poi.type);
      const colorValues = hexToRgb(poiColor);
      if (colorValues) {
        marker.css('--poi-glow-color', `rgba(${colorValues.r}, ${colorValues.g}, ${colorValues.b}, 0.8)`);
        marker.css('--poi-stroke-color', poiColor);
        marker.css('--poi-fill-color', `rgba(${colorValues.r}, ${colorValues.g}, ${colorValues.b}, 0.2)`);
      }
      
      // Update selection indicator
      updateSelectionIndicator();
      
      showNotification('POI added and selected (awaiting approval)');
    } else {
      showNotification('POI added successfully (awaiting approval)');
    }
    
    // Reset form and exit add mode
    $('#poi-form').hide();
    $('#poi-desc').val('');
    $('#poi-x').val('');
    $('#poi-y').val('');
    tempPoi = null;
    addMode = false;
    $('#add-mode-btn').removeClass('active');
    $('#game-map').css('cursor', 'default');
    
    // Hide the context menu
    $('#context-menu').hide();
    
    return;
  }
  
  // If no manual coordinates, use the tempPoi from map click
  if (!tempPoi) return;

  // Calculate adjusted coordinates for saving
  const adjustedX = (tempPoi.x - offsetX) * 1.664;
  const adjustedY = (tempPoi.y - offsetY) * 1.664;

  const poi = {
    id: 'poi-' + Date.now(),
    name: tempPoi.name,
    type: poiType,
    description: $('#poi-desc').val().trim(),
    x: formatCoordinateForStorage(adjustedX),
    y: formatCoordinateForStorage(adjustedY),
    visible: true,
    approved: false, // Mark new POIs as unapproved
    dateAdded: new Date().toISOString(),
    sessionId: sessionId // Add session ID to track who created this POI
  };

  pois.push(poi);
  renderPois();
  savePoisToStorage();
  
  // Send unapproved POI to server
  saveUnapprovedPoi(poi);

  // Check if we have multiple POIs selected in the URL
  const manualParams = getUrlParameters();
  if (manualParams.select && manualParams.select.split(',').length > 1) {
    // Add the new POI to the selected POIs list
    selectedPois.push(poi.id);
    selectedPoi = poi.id; // Make the new POI the primary selection
    
    // Update the URL with the new selection
    updateUrlWithSelection();
    
    // Ensure the new POI is visible
    poi.visible = true;
    
    // Update the visual state of the POI marker
    const marker = $(`.poi-marker[data-id="${poi.id}"]`);
    marker.addClass('selected');
    
    // Apply styling to the marker
    const poiColor = getPoiColor(poi.type);
    const colorValues = hexToRgb(poiColor);
    if (colorValues) {
      marker.css('--poi-glow-color', `rgba(${colorValues.r}, ${colorValues.g}, ${colorValues.b}, 0.8)`);
      marker.css('--poi-stroke-color', poiColor);
      marker.css('--poi-fill-color', `rgba(${colorValues.r}, ${colorValues.g}, ${colorValues.b}, 0.2)`);
    }
    
    // Update selection indicator
    updateSelectionIndicator();
    
    showNotification('POI added and selected (awaiting approval)');
  } else {
    showNotification('POI added successfully (awaiting approval)');
  }

  // Reset form and add mode
  $('#poi-form').hide();
  tempPoi = null;
  addMode = false;
  $('#add-mode-btn').removeClass('active');
  $('#game-map').css('cursor', 'default');

  // Hide the context menu
  $('#context-menu').hide();
}

function cancelAddPoi() {
  $('#poi-form').hide();
  tempPoi = null;
  
  // Hide the context menu
  $('#context-menu').hide();
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
  // Debug log to help identify issues
  console.log('Deleting POI:', poiId);
  console.log('Current session ID:', sessionId);
  
  const poi = pois.find(p => p.id === poiId);
  if (!poi) {
    console.error('POI not found:', poiId);
    return;
  }
  
  console.log('POI session ID:', poi.sessionId);
  console.log('Is owned by current session:', poi.sessionId === sessionId);
  console.log('Has edit permission:', hasEditPermission());
  
  // Check if this is an approved POI
  if (poi.approved === true) {
    showNotification('Cannot delete approved POIs', true);
    return;
  }
  
  // Users with edit permission can delete any unapproved POI
  // Users without edit permission can only delete POIs they created
  if (!hasEditPermission() && poi.sessionId && poi.sessionId !== sessionId) {
    showNotification('You can only delete POIs that you created in this session', true);
    return;
  }
  
  // Confirm deletion
  if (!confirm(`Are you sure you want to delete this POI?\n\nType: ${poi.type}\nCoordinates: X: ${poi.x}, Y: ${poi.y}`)) {
    return;
  }
  
  // Remove from local array
  pois = pois.filter(p => p.id !== poiId);

  // Send delete request to server for unapproved POIs
  if (poi.approved === false) {
    // Log the canEdit value for debugging
    const canEditValue = hasEditPermission() ? '1' : '0';
    console.log('Sending delete request with canEdit:', canEditValue);
    
    // Include canEdit in both the URL and the request body
    const url = `${API_ENDPOINT}/delete-poi${hasEditPermission() ? '?canEdit=1' : ''}`;
    console.log('Request URL:', url);
    
    fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ 
        id: poiId,
        sessionId: sessionId,
        canEdit: canEditValue
      }),
    })
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        showNotification('POI deleted successfully');
        renderPois();
        savePoisToStorage(); // Save changes to localStorage
      } else {
        showNotification('Error deleting POI: ' + data.error, true);
      }
    })
    .catch(error => {
      console.error('Error deleting POI:', error);
      showNotification('Error deleting POI', true);
    });
  } else {
    renderPois();
    savePoisToStorage(); // Save changes to localStorage
  }
}

// Function to approve a POI
function approvePoi(poiId) {
  const poi = pois.find(p => p.id === poiId);
  if (!poi) return;

  // Only users with canEdit=1 can approve POIs
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

  // Create a copy of the POI with approved status
  const approvedPoi = { 
    ...poi, 
    approved: true,
    canEdit: hasEditPermission() ? '1' : '0'
  };

  // Show loading notification
  showNotification('Approving POI...');

  // Log the canEdit value for debugging
  const canEditValue = hasEditPermission() ? '1' : '0';
  console.log('Sending approve request with canEdit:', canEditValue);
  
  // Include canEdit in both the URL and the request body
  const url = `${API_ENDPOINT}/approve-poi${hasEditPermission() ? '?canEdit=1' : ''}`;
  console.log('Request URL:', url);

  // Send approval request to server
  fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
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
      // Update local POI
      const index = pois.findIndex(p => p.id === poiId);
      if (index !== -1) {
        pois[index] = { ...pois[index], approved: true };
      }
      
      showNotification('POI approved successfully');
      
      // Refresh POIs from server to ensure we have the latest data
      loadPoisFromFile();
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
}

// Context menu functions and saving/editing POIs
function showContextMenu(screenX, screenY, mapX, mapY) {
  // Clear the selectedPoi to indicate we're creating a new POI
  selectedPoi = null;
  
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
    posX = windowWidth - menuWidth - 10; // 10px padding from edge
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

  $('#context-poi-type').val('shelter');
  $('#context-poi-note').val('');
  $('#context-delete-btn').hide();

  // Update coordinates display
  $('#context-coordinates').text(`X: ${formatCoordinate(mapX)}, Y: ${formatCoordinate(mapY)}`);

  $('#context-poi-type').css('color', getPoiColor($('#context-poi-type').val()));

  const adjustedX = (mapX - offsetX) * 1.664;
  const adjustedY = (mapY - offsetY - MAP_HEIGHT) * 1.664;

  contextMenu.data('map-x', adjustedX);
  contextMenu.data('map-y', adjustedY);

  contextMenu.css({
    top: posY + 'px',
    left: posX + 'px'
  }).show();

  // Event handlers are now set in updateContextMenuHtml
  
  contextMenu.off('click').on('click', function (e) {
    e.stopPropagation();
  });
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
  const mapX = contextMenu.data('map-x');
  const mapY = contextMenu.data('map-y');

  const name = `POI-${Date.now().toString().slice(-4)}`;
  const type = document.getElementById('context-poi-type').value;
  const description = $('#context-poi-note').val().trim();

  const poi = {
      id: 'poi-' + Date.now(),
      name: name,
      type: type,
      description: description,
      x: formatCoordinateForStorage(mapX),
      y: formatCoordinateForStorage(mapY),
      visible: true,
      approved: false, // Mark new POIs as unapproved
      dateAdded: new Date().toISOString(),
      sessionId: sessionId // Add session ID to track who created this POI
  };

  // Add to local array temporarily
  pois.push(poi);
  renderPois();
  
  // Send unapproved POI to server
  saveUnapprovedPoi(poi);
  
  contextMenu.hide();
  
  // Select the new POI after adding it
  selectPoi(poi.id);
}

// Function to save unapproved POIs to the server
function saveUnapprovedPoi(poi) {
    // Show loading notification
    showNotification('Saving new POI...');
    
    // Make a copy of the POI to avoid modifying the original
    const poiToSave = { ...poi };
    
    // Ensure the POI has approved=false
    poiToSave.approved = false;
    
    fetch(`${API_ENDPOINT}/save-poi`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            ...poiToSave,
            action: 'create' // Add an action flag to indicate this is a new POI
        }),
    })
    .then(response => {
        if (!response.ok) {
            throw new Error(`Server returned ${response.status}: ${response.statusText}`);
        }
        return response.json();
    })
    .then(data => {
        console.log('POI saved to file successfully:', data);
        
        if (data.success) {
            showNotification('POI saved to draft file');
            
            // Force reload POIs from server to ensure we have the latest data
            loadPoisFromFile();
        } else {
            showNotification('Error saving POI: ' + (data.error || 'Unknown error'), true);
            console.error('Server reported error:', data.error);
            
            // Fallback to local storage if server save fails
            const unapprovedPois = JSON.parse(localStorage.getItem('unapproved_pois') || '[]');
            unapprovedPois.push(poi);
            localStorage.setItem('unapproved_pois', JSON.stringify(unapprovedPois));
        }
    })
    .catch(error => {
        console.error('Error saving POI to file:', error);
        showNotification('Failed to save POI to file: ' + error.message, true);
        
        // Fallback to local storage if server save fails
        const unapprovedPois = JSON.parse(localStorage.getItem('unapproved_pois') || '[]');
        unapprovedPois.push(poi);
        localStorage.setItem('unapproved_pois', JSON.stringify(unapprovedPois));
    });
}

function saveEditedPoi() {
  // Use selectedPoi instead of getting it from contextMenu.data
  const poiId = selectedPoi;
  
  // Debug log to help identify issues
  console.log('Editing POI:', poiId);
  console.log('Current session ID:', sessionId);
  
  const poi = pois.find(p => p.id === poiId);
  if (!poi) {
    console.error('POI not found:', poiId);
    return;
  }
  
  console.log('POI session ID:', poi.sessionId);
  console.log('Is owned by current session:', poi.sessionId === sessionId);

  // Check if user has permission to edit this POI
  const isAdmin = hasEditPermission();
  const isOwner = poi.sessionId === sessionId;
  
  if (!isAdmin && !isOwner) {
    showNotification('You do not have permission to edit this POI', true);
    $('#context-menu').hide();
    return;
  }

  // Additional safety check - don't allow editing approved POIs unless admin
  if (poi.approved === true && !isAdmin) {
    showNotification('Cannot edit approved POIs', true);
    $('#context-menu').hide();
    return;
  }

  // Update POI properties
  poi.type = $('#context-poi-type').val();
  poi.description = $('#context-poi-note').val().trim();
  poi.lastEdited = new Date().toISOString(); // Add last edited timestamp

  // If this is an unapproved POI, send the updated version to the server
  if (poi.approved === false) {
    // Show loading notification
    showNotification('Saving changes...');
    
    // Send the updated POI to the server
    $.ajax({
      url: `${API_ENDPOINT}/save-poi`,
      method: 'POST',
      data: JSON.stringify({
        ...poi,
        action: 'update' // Add an action flag to indicate this is an update
      }),
      contentType: 'application/json',
      success: function(response) {
        console.log('POI updated on server successfully:', response);
        
        if (response.success) {
          showNotification('POI updated successfully (awaiting approval)');
          
          // Update the local POI with the server response
          if (response.pois && Array.isArray(response.pois)) {
            // Find the updated POI in the response
            const updatedPoi = response.pois.find(p => p.id === poiId);
            if (updatedPoi) {
              // Update the local POI with the server version
              Object.assign(poi, updatedPoi);
            }
          }
          
          // Render the updated POIs
          renderPois();
          savePoisToStorage();
          
        } else {
          showNotification('Error updating POI: ' + (response.error || 'Unknown error'), true);
        }
      },
      error: function(xhr, status, error) {
        console.error('Error updating POI on server:', error);
        showNotification('POI updated locally, but failed to update on server', true);
        
        // Still update local storage even if server update fails
        renderPois();
        savePoisToStorage();
      }
    });
  } else {
    // For approved POIs, just update locally
    renderPois();
    savePoisToStorage();
    showNotification('POI updated successfully');
  }
  
  contextMenu.hide();
  selectPoi(poiId);
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
      const marker = $(`
          <div class="poi-marker ${poi.approved ? 'approved' : 'unapproved'} ${poi.id === selectedPoi ? 'selected' : ''} ${isCurrentSession ? 'current-session' : ''}" 
               data-id="${poi.id}" 
               style="left: ${realX}px; top: ${realY}px;">
              <svg viewBox="0 0 24 24">
                  <path fill="transparent" 
                        stroke="${poiColor}" 
                        stroke-width="1.5"
                        d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
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
  const normalizedType = String(type).toLowerCase().trim();
  switch (normalizedType) {
    case 'shelter': return '#ffd700'; // Gold for Rebirth Shelter
    case 'bunker': return '#ff8c00'; // Dark orange for Rebirth Bunker (more visible than dark gold)
    case 'fragment': return '#32cd32'; // Lime green (more vibrant than previous green)
    case 'machinery': return '#a9a9a9'; // Darker gray for Machinery Parts (more visible)
    case 'electronics': return '#1e90ff'; // Dodger blue (slightly more vibrant)
    case 'secret': return '#4682b4'; // Steel blue (more vibrant than previous gray-blue)
    case 'ec-kits': return '#da70d6'; // Orchid (more vibrant than light purple)
    case 'collectibles': return '#ff69b4'; // Hot pink (more vibrant than light pink)
    case 'loot': return '#9932cc'; // Dark orchid (more vibrant purple)
    case 'container': return '#9b8840'; // Gold-brown for Locked Containers
    default:
      console.log('Unknown POI type:', type);
      return '#ffffff';
  }
}

// Storage and sync functions
function loadPoisFromStorage() {
  const storedData = localStorage.getItem(STORAGE_KEY);
  console.log('Loading POIs from storage');
  
  if (storedData) {
    try {
      const data = JSON.parse(storedData);
      pois = data.pois || []; // Use empty array if none in storage
      lastSyncTime = data.lastSyncTime || 0;
      
      console.log('Loaded POIs count:', pois.length);
      
      // Debug: Check if POIs have sessionId
      if (pois.length > 0) {
        console.log('Sample POI:', pois[0]);
        console.log('POIs with sessionId:', pois.filter(p => p.sessionId).length);
        console.log('POIs without sessionId:', pois.filter(p => !p.sessionId).length);
        
        // Add sessionId only to unapproved POIs that don't have it
        // Approved POIs should not have sessionId
        pois.forEach(poi => {
          if (!poi.sessionId && poi.approved === false) {
            console.log('Adding missing sessionId to unapproved POI:', poi.id);
            poi.sessionId = 'legacy-poi';
          }
        });
      }
      
      renderPois();
    } catch (e) {
      console.error('Error loading POIs from storage:', e);
      // If error loading, show default empty POIs
      pois = [];
      renderPois();
    }
  } else {
    // If no storage data exists, initialize with empty array
    pois = [];
    savePoisToStorage();
    renderPois();
  }
}

function savePoisToStorage() {
  const dataToStore = {
    pois: pois,
    lastSyncTime: Date.now()
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(dataToStore));
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

function toggleGroupVisibility(type, visible, updateUrl = true) {
  pois.forEach(poi => {
    if (poi.type === type) {
      poi.visible = visible;
    }
  });
  renderPois();
  savePoisToStorage();
  
  // Update URL when group visibility changes, if updateUrl is true
  if (updateUrl) {
    updateUrlWithGroups();
  }
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
  
  // If there are selected POIs, we'll only include those in the URL
  // and ignore group parameters
  if (selectedPois.length > 0) {
    // Get the current select parameter from the URL
    const urlParams = new URLSearchParams(window.location.search);
    const currentSelect = urlParams.get('select');
    
    // REMOVED: We no longer merge POIs from the URL with the current selection
    // This was causing the issue where clicking on a POI without Ctrl key
    // would still add to the previous selection instead of replacing it
    
    params.push(`select=${selectedPois.join(',')}`);
  } else {
    // Only include group parameters if no POIs are selected
    const selectedGroups = [];
    
    // Get all checked group checkboxes
    $('.group-checkbox:checked').each(function() {
      selectedGroups.push($(this).data('type'));
    });
    
    // Add group parameters
    if (selectedGroups.length > 0) {
      selectedGroups.forEach(group => {
        params.push(`group=${encodeURIComponent(group)}`);
      });
    }
  }
  
  // Add any other existing parameters except 'group' and 'select'
  const urlParams = new URLSearchParams(window.location.search);
  for (const [key, value] of urlParams.entries()) {
    if (key !== 'group' && key !== 'select') {
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
  
  if (params.select) {
    // Get the POI IDs from the URL
    const selectedIds = params.select.split(',');
    
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

// Function to process URLs and identify loaded POIs from the select parameter
function processUrlSelectedPois() {
  // Check if we've already processed the URL
  if (window.urlPoisProcessed) {
    return;
  }
  
  const params = getUrlParameters();
  
  if (!params.select) {
    window.urlPoisProcessed = true;
    return; // No POIs to process in URL
  }
  
  // Get the POI IDs from the URL
  const selectedIds = params.select.split(',');
  
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
      
      params.push(`select=${validIds.join(',')}`);
      
      // Add any other existing parameters except 'group' and 'select'
      const urlParams = new URLSearchParams(window.location.search);
      for (const [key, value] of urlParams.entries()) {
        if (key !== 'group' && key !== 'select') {
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
      // If no valid POIs, remove the select parameter
      let newUrl = window.location.pathname;
      let params = [];
      
      // Add any other existing parameters except 'group' and 'select'
      const urlParams = new URLSearchParams(window.location.search);
      for (const [key, value] of urlParams.entries()) {
        if (key !== 'group' && key !== 'select') {
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

// Function to hide all POIs that aren't in the URL's select parameter
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
  
  // Load POIs from storage
  loadPoisFromStorage();
  
  // Load POIs from server
  syncWithServer().then(() => {
    // Additional actions after sync if needed
  });
  
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
    
    // Check if this change was triggered by the Select All or Select None buttons
    // If it was triggered programmatically and has no originalEvent, don't update the URL
    const updateUrl = e.originalEvent !== undefined;
    
    toggleGroupVisibility(type, checked, updateUrl);
  });

  // Handle Select All button
  $('#select-all-btn').on('click', function() {
    // Check all group checkboxes (this will trigger the change event)
    $('.group-checkbox').prop('checked', true).trigger('change');
    
    // Clear 'group' and 'select' parameters from the URL
    clearUrlParameters();
    
    // Clear any selected POIs
    selectedPoi = null;
    selectedPois = [];
    $('.poi-marker').removeClass('selected multi-selected');
    // Clear group highlighting
    $('.poi-group-header').removeClass('highlighted');
    updateSelectionIndicator();
    
    showNotification('All groups selected, URL parameters cleared');
  });

  // Handle Select None button
  $('#select-none-btn').on('click', function() {
    // Uncheck all group checkboxes (this will trigger the change event)
    $('.group-checkbox').prop('checked', false).trigger('change');
    
    // Clear 'group' and 'select' parameters from the URL
    clearUrlParameters();
    
    // Clear any selected POIs
    selectedPoi = null;
    selectedPois = [];
    $('.poi-marker').removeClass('selected multi-selected');
    // Clear group highlighting
    $('.poi-group-header').removeClass('highlighted');
    updateSelectionIndicator();
    
    showNotification('All groups deselected, URL parameters cleared');
  });

  // Handle Select Only buttons
  $('.select-only-btn').on('click', function(e) {
    e.stopPropagation(); // Prevent triggering the checkbox click
    const selectedType = $(this).data('type');
    
    // Uncheck all checkboxes
    $('.group-checkbox').prop('checked', false).trigger('change');
    
    // Check only the selected one
    $(`.group-checkbox[data-type="${selectedType}"]`).prop('checked', true).trigger('change');
    
    // Clear 'group' and 'select' parameters from the URL
    clearUrlParameters();
    
    // Clear any selected POIs
    selectedPoi = null;
    selectedPois = [];
    $('.poi-marker').removeClass('selected multi-selected');
    // Clear group highlighting
    $('.poi-group-header').removeClass('highlighted');
    updateSelectionIndicator();
    
    // Center the map on POIs of the selected type
    centerMapOnPoisOfType(selectedType);
    
    showNotification(`Showing only ${selectedType} POIs, URL parameters cleared`);
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
});

// Function to handle map click events for both right-click and double-click
function handleMapClick(e) {
  const mapOffset = $('#game-map').offset();
  const clickX = (e.pageX - mapOffset.left) / currentZoom;
  const clickY = (e.pageY - mapOffset.top) / currentZoom;
  const clickedPoi = $(e.target).closest('.poi-marker');

  if (addMode) {
    handleAddModeClick(e);
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
      updateSelectionIndicator();
      updateUrlWithSelection();
    }
    
    // Only show context menu for right-click or double-click
    // This is determined by the event type that triggered this function
    if (e.type === 'contextmenu' || e.type === 'dblclick') {
      showContextMenu(e.pageX, e.pageY, clickX, clickY);
    }
  }
}

// Function to handle clicks when in add mode
function handleAddModeClick(e) {
  const mapOffset = $('#game-map').offset();
  const mapX = Math.round((e.pageX - mapOffset.left) / currentZoom);
  const mapY = Math.round(((e.pageY - mapOffset.top) / currentZoom) - MAP_HEIGHT);

  // Apply the offsets
  const adjustedX = (mapX - offsetX) * 1.664;
  const adjustedY = (mapY - offsetY) * 1.664;

  // Set the coordinates in the form
  $('#poi-x').val(formatCoordinate(adjustedX));
  $('#poi-y').val(formatCoordinate(adjustedY));

  // Show the form
  $('#poi-form').show();
  $('#poi-type').focus();
}

// Function to update zoom level indicator
function updateZoomIndicator() {
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
  // Check if a session ID already exists in localStorage
  let existingSessionId = localStorage.getItem(SESSION_KEY);
  
  console.log('Initializing session ID');
  console.log('Existing session ID from localStorage:', existingSessionId);
  
  if (!existingSessionId) {
    // Generate a new session ID if none exists
    existingSessionId = 'session-' + Date.now() + '-' + Math.random().toString(36).substring(2, 15);
    localStorage.setItem(SESSION_KEY, existingSessionId);
    console.log('Generated new session ID:', existingSessionId);
  }
  
  sessionId = existingSessionId;
  console.log('Session ID set to:', sessionId);
  
  // Debug: Check if sessionId is properly set
  setTimeout(() => {
    console.log('Session ID after initialization:', sessionId);
  }, 1000);
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
}

// Function to center the map on selected POIs
function centerMapOnSelectedPois() {
  if (selectedPois.length === 0) return;
  
  // Get container dimensions
  const containerWidth = $('#map-container').width();
  const containerHeight = $('#map-container').height();
  
  // Calculate minimum zoom level based on container dimensions
  // This ensures the map always fills at least one dimension of the viewport
  const minZoomWidth = containerWidth / MAP_WIDTH;
  const minZoomHeight = containerHeight / MAP_HEIGHT;
  const minZoom = Math.max(0.2, Math.min(minZoomWidth, minZoomHeight));
  
  // If only one POI is selected, center directly on it
  if (selectedPois.length === 1) {
    const poi = pois.find(p => p.id === selectedPois[0]);
    if (poi) {
      console.log("Centering on single POI:", poi);
      
      // Calculate the position to center this POI
      mapPosition = {
        x: containerWidth / (2 * currentZoom) - (poi.x / 1.664) - offsetX,
        y: containerHeight / (2 * currentZoom) - (poi.y / 1.664) - offsetY - MAP_HEIGHT
      };
      
      // Apply boundary constraints to keep the map inside the viewport
      applyMapBoundaryConstraints(containerWidth, containerHeight);
      
      updateMapTransform();
      showNotification("Centered map on selected POI");
    }
  } else {
    // For multiple POIs, calculate the bounding box
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    
    // Find the bounds of all selected POIs
    selectedPois.forEach(id => {
      const poi = pois.find(p => p.id === id);
      if (poi) {
        const realX = (poi.x / 1.664) + offsetX;
        const realY = (poi.y / 1.664) + offsetY + MAP_HEIGHT;
        
        minX = Math.min(minX, realX);
        minY = Math.min(minY, realY);
        maxX = Math.max(maxX, realX);
        maxY = Math.max(maxY, realY);
      }
    });
    
    console.log("Bounding box for selected POIs:", { minX, minY, maxX, maxY });
    
    // Calculate center of the bounding box
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    
    // Calculate the width and height of the bounding box
    const width = maxX - minX;
    const height = maxY - minY;
    
    // Ensure a minimum bounding box size to prevent extreme zoom on very close POIs
    const minBoxSize = 50; // Minimum size in pixels
    const adjustedWidth = Math.max(width, minBoxSize);
    const adjustedHeight = Math.max(height, minBoxSize);
    
    // Add padding (20% of the bounding box size)
    const paddingX = adjustedWidth * 0.2;
    const paddingY = adjustedHeight * 0.2;
    
    // Calculate the zoom level needed to fit the bounding box with padding
    const zoomX = containerWidth / (adjustedWidth + paddingX * 2);
    const zoomY = containerHeight / (adjustedHeight + paddingY * 2);
    
    // Use the smaller of the two zoom levels to ensure everything fits
    // But don't go below the minimum zoom level or above the maximum zoom level
    const newZoom = Math.max(minZoom, Math.min(Math.min(zoomX, zoomY), 2.0));
    
    // Only change zoom if it's significantly different
    if (Math.abs(newZoom - currentZoom) > 0.1) {
      currentZoom = newZoom;
    }
    
    // Calculate the position to center the bounding box
    mapPosition = {
      x: containerWidth / (2 * currentZoom) - centerX,
      y: containerHeight / (2 * currentZoom) - centerY
    };
    
    // Apply boundary constraints to keep the map inside the viewport
    applyMapBoundaryConstraints(containerWidth, containerHeight);
    
    updateMapTransform();
    showNotification(`Centered map on ${selectedPois.length} selected POIs`);
  }
}

// Function to clear 'group' and 'select' parameters from the URL
function clearUrlParameters() {
  // Create the base URL
  let newUrl = window.location.pathname;
  let params = [];
  
  // Add any other existing parameters except 'group' and 'select'
  const urlParams = new URLSearchParams(window.location.search);
  for (const [key, value] of urlParams.entries()) {
    if (key !== 'group' && key !== 'select') {
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
  }
}

// Function to apply boundary constraints to the map position
function applyMapBoundaryConstraints(containerWidth, containerHeight) {
  // Ensure the map doesn't go beyond the viewport boundaries
  if (MAP_WIDTH * currentZoom < containerWidth) {
    // If the map is smaller than the container, center it horizontally
    mapPosition.x = (containerWidth / currentZoom - MAP_WIDTH) / 2;
  } else {
    // If the map is larger than the container, constrain it to the boundaries
    const minX = containerWidth / currentZoom - MAP_WIDTH;
    const maxX = 0;
    mapPosition.x = Math.max(minX, Math.min(maxX, mapPosition.x));
  }

  if (MAP_HEIGHT * currentZoom < containerHeight) {
    // If the map is smaller than the container, center it vertically
    mapPosition.y = (containerHeight / currentZoom - MAP_HEIGHT) / 2;
  } else {
    // If the map is larger than the container, constrain it to the boundaries
    const minY = containerHeight / currentZoom - MAP_HEIGHT;
    const maxY = 0;
    mapPosition.y = Math.max(minY, Math.min(maxY, mapPosition.y));
  }
}

// Function to preload overlay images
function preloadOverlayImages() {
  // Preload heatmap image
  const heatmapImage = new Image();
  heatmapImage.onload = function() {
    heatmapImagePreloaded = true;
    console.log('Heatmap image preloaded');
  };
  heatmapImage.src = 'maps/Maynard_Heatmap_Transparent.png';
  
  // Preload guide image
  const guideImage = new Image();
  guideImage.onload = function() {
    guideImagePreloaded = true;
    console.log('Guide image preloaded');
  };
  guideImage.src = 'maps/Maynard_Guide_Transparent.png';
}
