# Exoborne Maps

An interactive mapping application for Exoborne game locations, points of interest, and resources.

## Features

- Interactive map with custom markers for different types of points of interest
- Admin authentication system for managing map data
- Secure storage of sensitive information using environment variables
- User-friendly interface for exploring game locations
- Ability to add, edit, and delete points of interest
- Approval system for user-submitted locations

## Security Enhancements

The application has been updated with several security enhancements:

1. **Environment Variable Configuration**
   - Sensitive information (JWT secret, admin password) is now stored in environment variables
   - See [Environment Variable Authentication Guide](backend/README-ENV-VARS.md) for setup instructions

2. **Secure Admin Authentication**
   - JWT-based authentication system
   - Admin login with password verification
   - Secure token handling

3. **Permission-Based Access Control**
   - Role-based permissions for map editing
   - Admin-only functions for approving and managing content

## Getting Started

### Prerequisites

- Node.js (v14 or later)
- npm (v6 or later)

### Installation

1. Clone the repository:
   ```
   git clone https://github.com/yourusername/exoborne-maps.git
   cd exoborne-maps
   ```

2. Install dependencies:
   ```
   npm install
   cd backend
   npm install
   ```

3. Set up environment variables:
   ```
   cd backend
   cp .env.example .env
   ```
   Edit the `.env` file to set your JWT_SECRET and ADMIN_PASSWORD.

4. Start the server:
   ```
   cd backend
   node server.js
   ```

5. Open `default.html` in your browser or serve the frontend files using a web server.

## Development

### Project Structure

- `app.js` - Main frontend JavaScript file
- `default.html` - Main HTML file
- `styles.css` - CSS styles
- `backend/` - Server-side code
  - `server.js` - Express server
  - `services/` - Business logic services
  - `config/` - Configuration files
  - `scripts/` - Utility scripts

### Environment Variable Authentication

For detailed instructions on setting up and using environment variables with this application, see the [Environment Variable Authentication Guide](backend/README-ENV-VARS.md).

## Deployment

The application can be deployed to various hosting platforms:

### Azure Web App

1. Create an Azure Web App
2. Set up Continuous Deployment from your Git repository
3. Configure environment variables in the Azure Portal:
   - `JWT_SECRET=your-jwt-secret`
   - `ADMIN_PASSWORD=your-admin-password`
   - `NODE_ENV=production`

### Other Hosting Platforms

For other hosting platforms, ensure you:
1. Set up the appropriate environment variables
2. Configure the server to run on the correct port
3. Ensure the static files are properly served

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the LICENSE file for details. 