FROM nginx:alpine

RUN rm -rf /usr/share/nginx/html/*

COPY deploy/nginx-docker.conf /etc/nginx/conf.d/default.conf
COPY app/ /usr/share/nginx/html/

EXPOSE 80
