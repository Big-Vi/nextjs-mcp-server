#!/bin/bash

# Build and Push Script for DevOps MCP Server
# Usage: ./build-and-push.sh [tag]

# Set your Docker Hub username here
DOCKER_USERNAME="147379"  # Replace with your actual Docker Hub username
IMAGE_NAME="devops-mcp-server"
TAG=${1:-latest}

echo "Building Docker image: ${DOCKER_USERNAME}/${IMAGE_NAME}:${TAG}"

# Build the Docker image
docker build -t ${DOCKER_USERNAME}/${IMAGE_NAME}:${TAG} .

if [ $? -eq 0 ]; then
    echo "✅ Build successful!"
    
    echo "Pushing to Docker Hub..."
    docker push ${DOCKER_USERNAME}/${IMAGE_NAME}:${TAG}
    
    if [ $? -eq 0 ]; then
        echo "✅ Push successful!"
        echo "Image available at: ${DOCKER_USERNAME}/${IMAGE_NAME}:${TAG}"
    else
        echo "❌ Push failed!"
        exit 1
    fi
else
    echo "❌ Build failed!"
    exit 1
fi
