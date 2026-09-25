<?php

namespace App;

use Illuminate\Database\Eloquent\Model;

class Product extends Model
{
    protected $table = 'products';

    protected $fillable = [
        'name', 'category', 'price', 'stock', 'status',
        'media_name', 'media_type', 'media_url',
    ];

    protected $casts = [
        'id' => 'integer',
        'price' => 'float',
        'stock' => 'integer',
    ];
}
