<?php

namespace App\Http\Controllers;

use App\Product;
use App\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;

class ApiController extends Controller
{
    public function health()
    {
        return response()->json(['ok' => true, 'databaseTime' => now()->toIso8601String()]);
    }

    public function login(Request $request)
    {
        $credentials = $request->only('email', 'password');
        $user = User::where('email', strtolower(trim($credentials['email'] ?? '')))
            ->where('is_active', true)
            ->first();

        if (!$user || !Hash::check($credentials['password'] ?? '', $user->password_hash)) {
            return response()->json(['message' => 'Email atau password tidak sesuai.'], 401);
        }

        return response()->json(['user' => $this->userPayload($user)]);
    }

    public function products()
    {
        return response()->json(Product::orderBy('created_at', 'desc')->get()->map([$this, 'productPayload'])->values());
    }

    public function storeProduct(Request $request)
    {
        $data = $this->validateProduct($request);
        $product = Product::create($data);

        return response()->json($this->productPayload($product), 201);
    }

    public function updateProduct(Request $request, $id)
    {
        $product = Product::find($id);
        if (!$product) return response()->json(['message' => 'Product not found'], 404);

        $product->update($this->validateProduct($request));
        return response()->json($this->productPayload($product->fresh()));
    }

    public function deleteProduct($id)
    {
        $product = Product::find($id);
        if (!$product) return response()->json(['message' => 'Product not found'], 404);

        $product->delete();
        return response('', 204);
    }

    public function users()
    {
        return response()->json(User::orderBy('created_at', 'desc')->get()->map([$this, 'userPayload'])->values());
    }

    public function storeUser(Request $request)
    {
        $data = $this->validateUser($request, false);
        $data['password_hash'] = Hash::make($data['password']);
        unset($data['password']);
        $user = User::create($data);

        return response()->json($this->userPayload($user), 201);
    }

    public function updateUser(Request $request, $id)
    {
        $user = User::find($id);
        if (!$user) return response()->json(['message' => 'User not found'], 404);

        $data = $this->validateUser($request, true);
        if (!empty($data['password'])) {
            $data['password_hash'] = Hash::make($data['password']);
        }
        unset($data['password']);
        $user->update($data);

        return response()->json($this->userPayload($user->fresh()));
    }

    public function deleteUser($id)
    {
        $user = User::find($id);
        if (!$user) return response()->json(['message' => 'User not found'], 404);

        $user->delete();
        return response('', 204);
    }

    private function validateProduct(Request $request)
    {
        $data = Validator::make($request->all(), [
            'name' => 'required|string|max:160',
            'category' => 'required|string|max:80',
            'price' => 'required|numeric|min:0',
            'stock' => 'required|integer|min:0',
            'status' => 'nullable|in:Active,Low stock,Out of stock',
            'media.name' => 'nullable|string|max:255',
            'media.type' => 'nullable|string|max:100',
            'media.url' => 'nullable|string',
        ])->validate();

        $stock = (int) $data['stock'];
        return [
            'name' => $data['name'],
            'category' => $data['category'],
            'price' => $data['price'],
            'stock' => $stock,
            'status' => $stock === 0 ? 'Out of stock' : ($data['status'] ?? 'Active'),
            'media_name' => $data['media']['name'] ?? null,
            'media_type' => $data['media']['type'] ?? null,
            'media_url' => $data['media']['url'] ?? null,
        ];
    }

    private function validateUser(Request $request, $updating)
    {
        $emailRule = Rule::unique('users', 'email');
        if ($updating) {
            $emailRule->ignore($request->route('id'));
        }

        $rules = [
            'name' => 'required|string|max:120',
            'email' => ['required', 'email', 'max:255', $emailRule],
            'role' => 'required|in:admin,staff',
            'isActive' => 'boolean',
            'password' => ($updating ? 'nullable' : 'required') . '|string|min:6',
        ];
        $data = Validator::make($request->all(), $rules)->validate();

        return [
            'name' => $data['name'],
            'email' => strtolower($data['email']),
            'role' => $data['role'],
            'is_active' => $data['isActive'] ?? true,
            'password' => $data['password'] ?? null,
        ];
    }

    public function productPayload(Product $product)
    {
        return [
            'id' => (int) $product->id,
            'name' => $product->name,
            'category' => $product->category,
            'price' => (float) $product->price,
            'stock' => (int) $product->stock,
            'status' => $product->status,
            'media' => $product->media_url ? ['name' => $product->media_name, 'type' => $product->media_type, 'url' => $product->media_url] : null,
            'createdAt' => $product->created_at,
            'updatedAt' => $product->updated_at,
        ];
    }

    public function userPayload(User $user)
    {
        return [
            'id' => (int) $user->id,
            'name' => $user->name,
            'email' => $user->email,
            'role' => $user->role,
            'isActive' => (bool) $user->is_active,
            'createdAt' => $user->created_at,
            'updatedAt' => $user->updated_at,
        ];
    }
}
