## Objective
Upgrade the "Smart Restock" feature into an AI-driven Demand Prediction system using Linear Regression and Exponential Moving Averages directly in PostgreSQL 18.

## Context
Tech Stack: PostgreSQL 18, NestJS.
Goal: Predict seasonality (e.g., increased sales of brake pads/wipers during rainy seasons) to suggest preventative restocking.

## Tasks
1. **Predictive SQL View (`backend/migrations/005_create_predictive_restock.sql`):**
   - Create a new migration for a complex view or materialized view `vw_prediccion_demanda`.
   - Calculate the 30-day, 60-day, and 90-day moving averages for product sales.
   - Implement a basic Linear Regression calculation (using PostgreSQL's `regr_slope` and `regr_intercept` aggregate functions) grouping sales data by month/week to determine the trend line (is demand going up or down?).
   - Calculate a "Suggested Order Quantity" based on the trend line projection for the next 30 days minus current stock.

2. **NestJS Integration (`inventario.service.ts`):**
   - Create an endpoint `GET /api/v1/inventario/prediccion-compras`.
   - Query the `vw_prediccion_demanda` view. 
   - Return structured JSON with strict TypeScript 5.9.3 interfaces containing the product details, current stock, trend status ('ALTA', 'BAJA', 'ESTABLE'), and the suggested purchase quantity.