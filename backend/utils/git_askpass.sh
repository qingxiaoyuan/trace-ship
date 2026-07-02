#!/bin/sh
case "$1" in
  *Username*) printf '%s\n' "$TRACE_SHIP_GIT_USERNAME" ;;
  *Password*) printf '%s\n' "$TRACE_SHIP_GIT_PASSWORD" ;;
  *) printf '%s\n' "$TRACE_SHIP_GIT_PASSWORD" ;;
esac

