# Gesture Classifier AI

A real-time mobile gesture recognition application that uses smartphone motion sensor data to classify user gestures with machine learning. The application captures accelerometer readings from a mobile device, processes the data in real time, and predicts gestures such as Circle, Wave, and Idle while displaying confidence scores and live sensor visualizations.

## Live Demo

🌐 https://gesture-908fb.web.app

---

## Overview

Gesture Classifier AI demonstrates how motion sensor data from a smartphone can be used to identify physical gestures through machine learning techniques. The application continuously reads accelerometer values from the device, analyzes movement patterns, and predicts the most likely gesture being performed.

The project provides an interactive interface where users can:

- Access smartphone motion sensors
- View real-time X, Y, and Z axis data
- Monitor live motion graphs
- Classify gestures instantly
- Display confidence scores for each prediction
- Visualize sensor behavior during movement

---

## Features

### Real-Time Sensor Tracking
- Captures accelerometer data directly from the mobile device
- Displays live X, Y, and Z axis values
- Updates continuously with device movement

### Gesture Recognition
Recognizes multiple gesture categories:

- Circle
- Wave
- Idle

### Confidence Scoring
- Displays prediction confidence percentages
- Highlights the most probable gesture
- Provides instant feedback to the user

### Live Data Visualization
- Real-time sensor graphs
- Dynamic motion tracking
- Smooth visual representation of accelerometer changes

### Mobile Optimized
- Responsive design
- Works directly in modern mobile browsers
- No application installation required

---

## Technology Stack

### Frontend
- React
- TypeScript
- Vite

### Machine Learning
- Custom gesture classification model
- Accelerometer-based motion analysis
- Real-time prediction engine

### Deployment
- Firebase Hosting

---

## System Workflow

```text
Smartphone Motion
        ↓
Accelerometer Data
        ↓
Data Processing
        ↓
Feature Extraction
        ↓
ML Classification
        ↓
Gesture Prediction
        ↓
Confidence Display
