import{b6 as e}from"./index-CramQklb.js";import{logDepthDeclarationWGSL as i}from"./logDepthDeclaration-C3ytzt4y.js";import{c as n,a as f}from"./clipPlaneVertex-PqciHzNC.js";import{f as a}from"./fogVertexDeclaration-DTRjLTzP.js";import{l as s}from"./logDepthVertex-ez6EzWZx.js";import{f as c}from"./fogVertex-jyuq3tL0.js";const r="skyVertexShader",t=`attribute position: vec3f;
#ifdef VERTEXCOLOR
attribute color: vec4f;
#endif
uniform world: mat4x4f;uniform view: mat4x4f;uniform viewProjection: mat4x4f;
#ifdef POINTSIZE
uniform pointSize: f32;
#endif
varying vPositionW: vec3f;
#ifdef VERTEXCOLOR
varying vColor: vec4f;
#endif
#include<logDepthDeclaration>
#include<clipPlaneVertexDeclaration>
#include<fogVertexDeclaration>
#define CUSTOM_VERTEX_DEFINITIONS
@vertex
fn main(input : VertexInputs)->FragmentInputs {
#define CUSTOM_VERTEX_MAIN_BEGIN
vertexOutputs.position=uniforms.viewProjection*uniforms.world* vec4f(vertexInputs.position,1.0);var worldPos: vec4f=uniforms.world* vec4f(vertexInputs.position,1.0);vertexOutputs.vPositionW= worldPos.xyz;
#include<clipPlaneVertex>
#include<logDepthVertex>
#include<fogVertex>
#ifdef VERTEXCOLOR
vertexOutputs.vColor=vertexInputs.color;
#endif
#define CUSTOM_VERTEX_MAIN_END
}
`;e.ShadersStoreWGSL[r]||(e.ShadersStoreWGSL[r]=t);const l=[i,n,a,f,s,c];for(const o of l)e.IncludesShadersStoreWGSL[o.name]||(e.IncludesShadersStoreWGSL[o.name]=o.shader);const v={name:r,shader:t};export{v as skyVertexShaderWGSL};
