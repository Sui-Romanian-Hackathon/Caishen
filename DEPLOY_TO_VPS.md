# Deploy to VPS Guide

Quick reference for deploying caishen to your VPS.

## 🚀 Initial Setup (First Time Only)

### 1. SSH into your VPS
```bash
ssh your-user@your-vps-ip
# or
ssh your-user@iseethereaper.com
```

### 2. Install prerequisites (if not already installed)
```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker & Docker Compose
sudo apt install -y docker.io docker-compose

# Add your user to docker group
sudo usermod -aG docker $USER
newgrp docker

# Install Node.js 20 (if running without Docker)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install git
sudo apt install -y git
```

### 3. Clone the repository
```bash
cd ~
git clone https://github.com/raulradulescu/my-tiny-project.git caishen
cd caishen
```

### 4. Set up environment
```bash
# Copy and edit .env
cp .env.example .env
nano .env
# Fill in your API keys (same as local .env)
```

### 5. Configure nginx
```bash
# Copy the nginx config
sudo cp nginx/caishen.iseethereaper.com.conf /etc/nginx/sites-available/caishen.iseethereaper.com

# Enable the site
sudo ln -s /etc/nginx/sites-available/caishen.iseethereaper.com /etc/nginx/sites-enabled/

# Get SSL certificate
sudo certbot --nginx -d caishen.iseethereaper.com

# Test nginx config
sudo nginx -t

# Reload nginx
sudo systemctl reload nginx
```

### 6. Start the application
```bash
# Using Docker (recommended)
docker compose up -d

# Check logs
docker compose logs -f telegram-gateway
```

---

## 🔄 Update/Redeploy (Every Time You Push Changes)

### Quick deploy script:
```bash
#!/bin/bash
# Save as ~/caishen/deploy.sh and chmod +x deploy.sh

cd ~/caishen

# Pull latest code
git pull origin main

# Restart containers
docker compose down
docker compose up -d --build

# Show logs
docker compose logs -f telegram-gateway
```

### Manual steps:
```bash
# SSH to VPS
ssh your-user@your-vps-ip

# Navigate to project
cd ~/caishen

# Pull latest code
git pull origin main

# Restart Docker containers
docker compose down
docker compose up -d --build

# Check status
docker compose ps

# View logs
docker compose logs -f telegram-gateway
```

---

## 📊 Monitoring

### Check if services are running
```bash
docker compose ps
```

### View logs
```bash
# All services
docker compose logs -f

# Just telegram-gateway
docker compose logs -f telegram-gateway

# Just redis
docker compose logs -f redis
```

### Check resource usage
```bash
docker stats
```

### Check nginx
```bash
# Test config
sudo nginx -t

# View access logs
sudo tail -f /var/log/nginx/caishen.access.log

# View error logs
sudo tail -f /var/log/nginx/caishen.error.log
```

---

## 🔧 Troubleshooting

### Port 3001 already in use
```bash
# Check what's using port 3001
sudo lsof -i :3001

# Kill the process
sudo kill -9 <PID>
```

### Docker permission denied
```bash
# Add your user to docker group
sudo usermod -aG docker $USER
newgrp docker
```

### Nginx config test fails
```bash
# Check syntax
sudo nginx -t

# View error details
sudo journalctl -xeu nginx
```

### Bot not responding
```bash
# Check webhook status
curl "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getWebhookInfo"

# Check if nginx is proxying correctly
curl http://localhost:3001/health

# Check if app is listening
sudo netstat -tlnp | grep 3001
```

### SQLite database issues
```bash
# Check if data directory exists
ls -la ~/caishen/data/

# Create if missing
mkdir -p ~/caishen/data
chmod 755 ~/caishen/data
```

---

## 🗑️ Clean Up

### Remove old containers
```bash
docker compose down
docker system prune -a
```

### Start fresh
```bash
docker compose down -v  # Also removes volumes
docker compose up -d --build
```

---

## 📝 Quick Commands Reference

| Task | Command |
|------|---------|
| **SSH to VPS** | `ssh user@vps-ip` |
| **Pull updates** | `cd ~/caishen && git pull` |
| **Restart app** | `docker compose down && docker compose up -d` |
| **View logs** | `docker compose logs -f telegram-gateway` |
| **Check status** | `docker compose ps` |
| **Reload nginx** | `sudo systemctl reload nginx` |
| **Test nginx** | `sudo nginx -t` |
| **Check webhook** | `curl https://api.telegram.org/bot<TOKEN>/getWebhookInfo` |

---

## 🔐 Security Checklist

- [ ] `.env` file has correct permissions: `chmod 600 .env`
- [ ] SQLite data directory: `chmod 755 data/`
- [ ] Nginx SSL certificate renewed (auto via certbot)
- [ ] Firewall allows ports 80, 443, and SSH
- [ ] Docker containers have memory limits (already set in docker-compose.yml)
- [ ] Secrets not committed to git (check `.gitignore`)

---

## 📞 Support

If something goes wrong:
1. Check logs: `docker compose logs -f`
2. Check nginx: `sudo tail -f /var/log/nginx/caishen.error.log`
3. Check webhook: `curl https://api.telegram.org/bot<TOKEN>/getWebhookInfo`
4. Restart everything: `docker compose down && docker compose up -d`
