FROM node:18.14-bullseye
RUN apt update && apt install -y python3 build-essential && ln -sf /usr/bin/python3 /usr/bin/python
WORKDIR /home/node/app
COPY package*.json ./
RUN npm ci && npm install -g browserify pkg
COPY . .
ARG INFO_VERSION="unknown"
RUN sed -i "s/.*VERSION_NAME.*/    VERSION_NAME: \"$INFO_VERSION\",/g" src/constants.js
RUN sh make_dist.sh

FROM jasongdove/ersatztv-ffmpeg:5.1.2-vaapi
EXPOSE 8000
WORKDIR /home/node/app
ENTRYPOINT [ "./dizquetv" ]
COPY --from=0 /home/node/app/dist/dizquetv /home/node/app/
RUN ln -s /usr/local/bin/ffmpeg /usr/bin/ffmpeg
