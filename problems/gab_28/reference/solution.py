import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.model_selection import train_test_split, GridSearchCV
from sklearn.metrics import mean_squared_error


np.random.seed(42)

socioeconomic_data = pd.read_csv('dataset/socioeconomic_data.csv', index_col=None, header=0)
od_data = pd.read_csv('dataset/od_data.csv', index_col=None, header=0)

# Aggregate OD flow data to subregion scale
od_aggregated = od_data.groupby(['Origin', 'Destination']).sum().reset_index()
od_aggregated = od_aggregated.rename(columns={'FlowVolume': 'TotalFlow'})

# Merge socio-economic data to create interaction pairs
merged_data = pd.merge(od_aggregated, socioeconomic_data, left_on='Origin', right_on='Subregion')
merged_data = pd.merge(merged_data, socioeconomic_data, left_on='Destination', right_on='Subregion', suffixes=('_Origin', '_Destination'))
merged_data = merged_data.drop(columns=['Subregion_Origin', 'Subregion_Destination'])

# Prepare data for Random Forest model
X = merged_data.drop(columns=['TotalFlow', 'Origin', 'Destination'])
y = merged_data['TotalFlow']

# Split data into training and testing sets
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

# Hyperparameter tuning using GridSearchCV
param_grid = {
    'n_estimators': [100, 200, 300],
    'max_depth': [None, 10, 20, 30],
    'min_samples_split': [2, 5, 10],
    'min_samples_leaf': [1, 2, 4]
}

rf_model = RandomForestRegressor(random_state=42)
grid_search = GridSearchCV(estimator=rf_model, param_grid=param_grid,
                           cv=5, scoring='neg_mean_squared_error', n_jobs=-1, verbose=2)

grid_search.fit(X_train, y_train)

best_rf_model = grid_search.best_estimator_

# Make pred ictions and evaluate the model
y_pred = best_rf_model.predict(X_test)
mse = mean_squared_error(y_test, y_pred)
print("Improved Mean Squared Error on Test Data:", mse)


