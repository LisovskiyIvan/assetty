import{b6 as o}from"./index-CTe2nUuT.js";const e="sceneUboDeclaration",t=`struct Scene {viewProjection : mat4x4<f32>,
#ifdef MULTIVIEW
viewProjectionR : mat4x4<f32>,
#endif 
view : mat4x4<f32>,
projection : mat4x4<f32>,
vEyePosition : vec4<f32>,
inverseProjection : mat4x4<f32>,
previousViewProjection : mat4x4<f32>,
taaJitter : vec2<f32>,};
#define SCENE_UBO
var<uniform> scene : Scene;
`;o.IncludesShadersStoreWGSL[e]||(o.IncludesShadersStoreWGSL[e]=t);const r={name:e,shader:t};export{r as s};
