#!/usr/bin/env bash
set -e

cd /var/www/caishen
git pull origin main

cd services/web-dapp
npm install
npm run build

rsync -av --delete out/ /var/www/caishen/web/

cd /var/www/caishen
nginx -t
systemctl reload nginx

docker-compose down
docker-compose up -d --build
docker-compose logs -f