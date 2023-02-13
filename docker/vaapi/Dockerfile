FROM node:12.18-alpine3.12
WORKDIR /home/node/app
COPY package*.json ./
RUN apk add --update --no-cache python3 build-base gcc && ln -sf /usr/bin/python3 /usr/bin/python
RUN npm ci && npm install -g browserify nexe@3.3.7
COPY . .
ARG INFO_VERSION="unknown"
RUN sed -i "s/.*VERSION_NAME.*/    VERSION_NAME: \"$INFO_VERSION\",/g" src/constants.js
RUN npm run build && LINUXBUILD=dizquetv sh make_dist.sh linuxonly

FROM jasongdove/ersatztv-ffmpeg:5.1.2-vaapi
EXPOSE 8000
WORKDIR /home/node/app
ENTRYPOINT [ "./dizquetv" ]
COPY --from=0 /home/node/app/dist/dizquetv /home/node/app/
RUN ln -s /usr/local/bin/ffmpeg /usr/bin/ffmpeg
