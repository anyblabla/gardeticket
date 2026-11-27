FROM nginx:alpine

RUN rm -rf /usr/share/nginx/html/*

COPY index.html aide.html theme-init.js style.css app.js manifest.json sw.js icon-192.png icon-512.png /usr/share/nginx/html/

EXPOSE 80
