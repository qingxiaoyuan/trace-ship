FROM alpine:latest

RUN apk add --no-cache subversion \
    && mkdir -p /var/svn

EXPOSE 3690
VOLUME ["/var/svn"]
WORKDIR /var/svn

CMD ["svnserve", "-d", "--foreground", "-r", "/var/svn"]
