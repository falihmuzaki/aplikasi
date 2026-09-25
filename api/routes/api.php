<?php

use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| API Routes
|--------------------------------------------------------------------------
|
| Here is where you can register API routes for your application. These
| routes are loaded by the RouteServiceProvider within a group which
| is assigned the "api" middleware group. Enjoy building your API!
|
*/

Route::get('/health', 'ApiController@health');
Route::post('/auth/login', 'ApiController@login');
Route::post('/auth/otp/verify', 'ApiController@verifyOtp');
Route::post('/auth/otp/resend', 'ApiController@resendOtp');
Route::post('/auth/password/forgot', 'ApiController@requestPasswordReset');
Route::post('/auth/password/reset', 'ApiController@resetPassword');

Route::middleware('token.auth')->group(function () {
	Route::get('/products', 'ApiController@products');
	Route::post('/products', 'ApiController@storeProduct');
	Route::put('/products/{id}', 'ApiController@updateProduct');
	Route::delete('/products/{id}', 'ApiController@deleteProduct');

	Route::get('/users', 'ApiController@users');
	Route::post('/users', 'ApiController@storeUser');
	Route::put('/users/{id}', 'ApiController@updateUser');
	Route::delete('/users/{id}', 'ApiController@deleteUser');
});
