FROM alpine:latest

# 同时提供 svn://（svnserve）与 http://（mod_dav_svn）两种访问方式
RUN apk add --no-cache \
        subversion \
        apache2 \
        apache2-utils \
        apache2-webdav \
        mod_dav_svn \
        bash \
    && mkdir -p /var/svn /etc/apache2/conf.d /var/log/apache2 /run/apache2

COPY svn-entrypoint.sh /usr/local/bin/svn-entrypoint.sh
RUN chmod +x /usr/local/bin/svn-entrypoint.sh

EXPOSE 3690 80
VOLUME ["/var/svn"]
WORKDIR /var/svn

CMD ["svn-entrypoint.sh"]