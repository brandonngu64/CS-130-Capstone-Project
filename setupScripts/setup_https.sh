#!/bin/bash

# --- CONFIGURATION ---
DOMAIN="yourgame.ddns.net"          # Your No-IP domain
GAME_PORT="8080"                    # The internal port your game/signaling runs on
EMAIL="your-email@example.com"      # Required for Let's Encrypt renewal warnings
# ---------------------

echo "Updating system packages..."
sudo apt update && sudo apt install -y nginx certbot python3-certbot-nginx

echo "Configuring initial Nginx block for validation..."
cat <<EOF | sudo tee /etc/nginx/sites-available/$DOMAIN
server {
    listen 80;
    server_name $DOMAIN;

    location / {
        proxy_pass http://127.0.0.1:$GAME_PORT;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
    }
}
EOF

# Enable configuration and restart Nginx
sudo ln -sf /etc/nginx/sites-available/$DOMAIN /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo systemctl restart nginx

echo "Obtaining SSL certificate via Certbot..."
# --nginx automatically modifies the nginx file to include the SSL cert path and forces a redirect to HTTPS
sudo certbot --nginx -d $DOMAIN --non-interactive --agree-tos -m $EMAIL --redirect

echo "Optimizing Nginx configuration for WebSockets & Rollback Netcode..."
cat <<EOF | sudo tee /etc/nginx/sites-available/$DOMAIN
server {
    listen 80;
    server_name $DOMAIN;
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl;
    server_name $DOMAIN;

    ssl_certificate /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:$GAME_PORT;
        
        # Vital metadata headers
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;

        # WebSocket support (Crucial for signaling/TURN interactions)
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "Upgrade";
        
        # Disable buffering to avoid latency spikes in fast-paced rollback games
        proxy_buffering off;
    }
}
EOF

echo "Testing Nginx config and reloading..."
sudo nginx -t && sudo systemctl reload nginx

echo "HTTPS initialization successfully completed!"