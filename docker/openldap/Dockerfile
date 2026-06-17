FROM alpine:latest

RUN apk add --no-cache openldap openldap-back-mdb openldap-clients \
    && mkdir -p /var/lib/openldap/openldap-data /etc/openldap/slapd.d /run/openldap /docker-entrypoint-init.d \
    && chown -R ldap:ldap /var/lib/openldap /etc/openldap /run/openldap

COPY slapd.conf /etc/openldap/slapd.conf
COPY init.sh /docker-entrypoint-init.d/init.sh
COPY init/ /docker-entrypoint-init.d/

RUN chown ldap:ldap /etc/openldap/slapd.conf /docker-entrypoint-init.d/init.sh /docker-entrypoint-init.d/*.ldif \
    && chmod +x /docker-entrypoint-init.d/init.sh

EXPOSE 389 636

USER ldap

ENTRYPOINT ["/docker-entrypoint-init.d/init.sh"]
