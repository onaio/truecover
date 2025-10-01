FROM --platform=linux/amd64 ghcr.io/openfaas/classic-watchdog:0.3.4 as watchdog

FROM --platform=linux/amd64 rocker/geospatial:4.2

# Allows you to add additional packages via build-arg
# ARG ADDITIONAL_PACKAGE

COPY --from=watchdog /fwatchdog /usr/bin/fwatchdog
RUN chmod +x /usr/bin/fwatchdog
# RUN apk --no-cache add ca-certificates ${ADDITIONAL_PACKAGE}

# Add non root user
# RUN addgroup -S app && adduser app -S -G app

WORKDIR /home/app/

COPY main.R             .

# RUN chown -R app /home/app
# USER app


RUN mkdir -p function

WORKDIR /home/app/function/
COPY function/install_packages.R function/
RUN Rscript function/install_packages.R

WORKDIR /home/app/

# USER root

COPY function           function

# USER app

ENV fprocess="Rscript main.R"
EXPOSE 8080

HEALTHCHECK --interval=3s CMD [ -e /tmp/.lock ] || exit 1

CMD ["fwatchdog"]
