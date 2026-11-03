import{b6 as e}from"./index-DTUGP53x.js";import{i as t}from"./iblVoxelOpacityAtomicMax-D1Nc5TVh.js";const r="iblVoxelGridPixelShader",i=`var voxel_storage: texture_storage_3d<r8unorm,write>;
#ifdef IBL_VOXEL_OPACITY_BUFFER
var<storage,read_write> voxelOpacityBuffer: array<atomic<u32>>;
#include<iblVoxelOpacityAtomicMax>
#endif
varying vNormalizedPosition: vec3f;flat varying f_swizzle: i32;@fragment
fn main(input: FragmentInputs)->FragmentOutputs {var size: vec3<u32>=textureDimensions(voxel_storage);var normPos: vec3f=input.vNormalizedPosition.xyz;switch (input.f_swizzle) {case 0: {normPos=normPos.zxy;break;}
case 1: {normPos=normPos.yzx;break;}
default: {normPos=normPos.xyz;break;}}
let coord: vec3<u32>=min(
vec3<u32>(u32(normPos.x*f32(size.x)),u32(normPos.y*f32(size.y)),u32(normPos.z*f32(size.z))),
size-vec3<u32>(1u));
#ifdef IBL_VOXEL_OPACITY_BUFFER
let vidx: u32=coord.x+coord.y*size.x+coord.z*size.x*size.y;voxelOpacityAtomicMax(vidx,255u);
#else
textureStore(voxel_storage,vec3<i32>(coord),vec4f(1.0,1.0,1.0,1.0));
#endif
fragmentOutputs.color=vec4<f32>(vec3<f32>(normPos),1.);}
`;e.ShadersStoreWGSL[r]||(e.ShadersStoreWGSL[r]=i);const s=[t];for(const o of s)e.IncludesShadersStoreWGSL[o.name]||(e.IncludesShadersStoreWGSL[o.name]=o.shader);const c={name:r,shader:i};export{c as iblVoxelGridPixelShaderWGSL};
