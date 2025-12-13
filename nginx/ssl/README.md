# SSL Certificate Directory

This directory should contain your SSL certificates for HTTPS.

## For Development (Self-Signed Certificate)

Generate a self-signed certificate for local development:

```bash
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout nginx/ssl/privkey.pem \
  -out nginx/ssl/fullchain.pem \
  -subj "/C=US/ST=State/L=City/O=Organization/CN=caishen.iseethereaper.com"
```

## For Production (Let's Encrypt)

1. Install certbot:

```bash
sudo apt-get update
sudo apt-get install certbot python3-certbot-nginx
```

2. Obtain certificate:

```bash
sudo certbot certonly --nginx -d caishen.iseethereaper.com
```

3. Copy certificates to this directory:

```bash
sudo cp /etc/letsencrypt/live/caishen.iseethereaper.com/fullchain.pem nginx/ssl/
sudo cp /etc/letsencrypt/live/caishen.iseethereaper.com/privkey.pem nginx/ssl/
```

4. Set up auto-renewal:

```bash
sudo certbot renew --dry-run
```

## Required Files

- `fullchain.pem` - Full certificate chain
- `privkey.pem` - Private key

**⚠️ Never commit these files to git! They are in .gitignore**
